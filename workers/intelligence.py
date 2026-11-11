#!/usr/bin/env python3
"""Isolated, local-only model and replay worker. One JSON request/response per line."""
import sys, json, os, time, hashlib, contextlib, importlib.metadata, math
from pathlib import Path
from datetime import datetime, timezone
from decimal import Decimal

ROOT = Path(__file__).resolve().parent
RUNTIME = Path(sys.argv[1]).resolve()
PINS = json.loads((ROOT.parent / 'packages/providers/pins.json').read_text())
# Inference never downloads weights or reads account/provider credentials.
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['USE_TF'] = '0'
os.environ['OMP_NUM_THREADS'] = '4'
MODELS = {}
VERIFIED = set()

def verify_files(folder, files):
    key = str(folder)
    if key in VERIFIED:
        return
    for relative, expected in files.items():
        p = folder / relative
        if not p.is_file() or p.stat().st_size != expected['bytes']:
            raise ValueError('MODEL_ARTIFACT_MISSING_OR_CHANGED: ' + relative)
        h = hashlib.sha256()
        with p.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                h.update(chunk)
        if h.hexdigest() != expected['sha256']:
            raise ValueError('MODEL_ARTIFACT_DIGEST_MISMATCH: ' + relative)
    VERIFIED.add(key)

def diagnostics(_):
    versions = {}
    for package in ['torch', 'laya', 'onnxruntime', 'nautilus_trader']:
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    return {'versions': versions, 'kronos': (RUNTIME/'models/kronos-mini/model.safetensors').is_file(),
            'laya': (RUNTIME/'models/laya/model.onnx.data').is_file() or (RUNTIME/'models/laya/model.safetensors').is_file(),
            'layaEngine': 'ONNXAgent' if (RUNTIME/'models/laya/model.onnx.data').is_file() else 'Agent',
            'network': 'disabled-for-local-inference'}

def forecast(data):
    import numpy as np
    import pandas as pd
    import torch
    sys.path.insert(0, str(ROOT/'vendor/kronos'))
    from model import Kronos, KronosTokenizer, KronosPredictor
    if 'kronos' not in MODELS:
        model_dir, tokenizer_dir = RUNTIME/'models/kronos-mini', RUNTIME/'models/kronos-tokenizer'
        verify_files(model_dir, PINS['kronos']['model']['files'])
        verify_files(tokenizer_dir, PINS['kronos']['tokenizer']['files'])
        torch.set_num_threads(4)
        model = Kronos.from_pretrained(str(model_dir), local_files_only=True)
        tokenizer = KronosTokenizer.from_pretrained(str(tokenizer_dir), local_files_only=True)
        MODELS['kronos'] = KronosPredictor(model, tokenizer, device='cpu', max_context=512)
    candles = data['candles']
    horizon = data['horizon']
    frame = pd.DataFrame(candles)
    dates = pd.Series(pd.to_datetime(frame.pop('timestamp'), utc=True).dt.tz_localize(None))
    interval = pd.Timedelta(seconds=data['intervalSeconds'])
    future = pd.Series([dates.iloc[-1] + interval*(i+1) for i in range(horizon)])
    # A fixed seed makes this specific CPU run reproducible; cross-device bit identity is not claimed.
    seed = int(data.get('seed', 7))
    torch.manual_seed(seed)
    np.random.seed(seed)
    result = MODELS['kronos'].predict(df=frame, x_timestamp=dates, y_timestamp=future,
            pred_len=horizon, T=1.0, top_p=0.9, sample_count=1, verbose=False)
    predictions = []
    for timestamp, row in result.iterrows():
        values = {k: float(row[k]) for k in ['open', 'high', 'low', 'close', 'volume']}
        if not all(np.isfinite(v) for v in values.values()):
            raise ValueError('INVALID_MODEL_FORECAST')
        predictions.append({'timestamp': timestamp.tz_localize('UTC').isoformat(), **values})
    last = candles[-1]['close']
    return {'predictions': predictions, 'forecastedReturn': predictions[-1]['close']/last-1,
            'lastObservedClose': last, 'model': PINS['kronos']['model'], 'tokenizer': PINS['kronos']['tokenizer'],
            'device': 'cpu', 'seed': seed, 'sampleCount': 1, 'eventProbability': None,
            'interpretation': 'OHLCV forecast for the supplied asset; not a binary-event probability.',
            'warnings': ['Unvalidated on this instrument and horizon; compare with held-out observations before strategy promotion.']}

def classify(data):
    if 'laya' not in MODELS:
        folder = RUNTIME/'models/laya'
        if (folder/'model.onnx').is_file():
            from laya.onnx_agent import ONNXAgent
            verify_files(folder, PINS['laya']['model']['files'])
            MODELS['laya'] = ONNXAgent(str(folder), onnx_path=str(folder/'model.onnx'),
                expected_sha256={k:v['sha256'] for k,v in PINS['laya']['model']['files'].items()})
            MODELS['laya_engine'] = 'laya.ONNXAgent'
        else:
            from laya import Agent
            import torch
            torch.set_num_threads(4)
            verify_files(folder, PINS['laya']['model']['checkpointFiles'])
            MODELS['laya'] = Agent(str(folder), device='cpu', backend='eager',
                expected_sha256={k:v['sha256'] for k,v in PINS['laya']['model']['checkpointFiles'].items()})
            MODELS['laya_engine'] = 'laya.Agent (PyTorch CPU)'
    result = MODELS['laya'].predict(data['state'], data['questions'], max_len=512, min_confidence=0.5)
    if result.get('usage', {}).get('truncated'):
        raise ValueError('CLASSIFIER_CONTEXT_TRUNCATED: shorten the evidence and question; no result accepted')
    return {'answers': result['answers'], 'abstained': any(a.get('abstention') == 'abstained' or a.get('low_confidence') for a in result['answers'].values()), 'usage': result.get('usage'), 'model': PINS['laya']['model'],
            'engine': MODELS['laya_engine'], 'runtime': importlib.metadata.version('laya'),
            'eventProbability': None, 'interpretation': 'Semantic classification of supplied evidence; not event odds.',
            'warnings': ['English checkpoint; financial task calibration has not been established.']}

def replay(data):
    """Execute timed, frozen market intents through Nautilus's actual backtest matching engine."""
    import pandas as pd
    import nautilus_trader
    from nautilus_trader.backtest.engine import BacktestEngine
    from nautilus_trader.config import BacktestEngineConfig, LoggingConfig
    from nautilus_trader.model.identifiers import Venue, InstrumentId, Symbol, TraderId
    from nautilus_trader.model.instruments import CurrencyPair
    from nautilus_trader.model.currencies import BTC, ETH, USD
    from nautilus_trader.model.objects import Price, Quantity, Money
    from nautilus_trader.model.enums import OmsType, AccountType, OrderSide
    from nautilus_trader.model.data import Bar, BarType
    from nautilus_trader.trading.strategy import Strategy
    symbol = data.get('symbol', 'BTC-USD')
    instrument_id = InstrumentId.from_str(symbol+'.WOLF')
    instrument = CurrencyPair(instrument_id=instrument_id, raw_symbol=Symbol(symbol),
        base_currency=BTC if symbol=='BTC-USD' else ETH, quote_currency=USD,
        price_precision=2, size_precision=6, price_increment=Price.from_str('0.01'),
        size_increment=Quantity.from_str('0.000001'), ts_event=0, ts_init=0,
        maker_fee=Decimal(str(data['feeBps']/10000)), taker_fee=Decimal(str(data['feeBps']/10000)))
    unit = {60:'1-MINUTE',300:'5-MINUTE',900:'15-MINUTE',3600:'1-HOUR',86400:'1-DAY'}[data['intervalSeconds']]
    bar_type = BarType.from_str(str(instrument_id)+'-'+unit+'-LAST-EXTERNAL')
    bars=[]
    for c in data['bars']:
        # Source candles identify bucket start. Publish its OHLCV only at the bucket close.
        ts=int(pd.Timestamp(c['timestamp']).value)+data['intervalSeconds']*1_000_000_000
        bars.append(Bar(bar_type=bar_type, open=Price(c['open'],2), high=Price(c['high'],2),
            low=Price(c['low'],2), close=Price(c['close'],2), volume=Quantity(c['volume'],6), ts_event=ts, ts_init=ts))
    frozen = {int(o['afterBar']): o for o in data['orders']}
    class FrozenIntents(Strategy):
        def __init__(self):
            super().__init__()
            self.index=-1
        def on_start(self):
            self.subscribe_bars(bar_type)
        def on_bar(self, bar):
            self.index+=1
            intent=frozen.get(self.index)
            if not intent:
                return
            side=OrderSide.BUY if intent['side']=='BUY' else OrderSide.SELL
            order=self.order_factory.market(instrument_id=instrument_id, order_side=side,
                quantity=Quantity(float(intent['quantity']),6))
            self.submit_order(order)
    engine=BacktestEngine(config=BacktestEngineConfig(trader_id=TraderId('WOLF-REPLAY'),
        logging=LoggingConfig(bypass_logging=True)))
    try:
        engine.add_venue(venue=Venue('WOLF'),oms_type=OmsType.NETTING,account_type=AccountType.CASH,
            starting_balances=[Money(data['startingCash'],USD)],base_currency=None,
            bar_execution=True,trade_execution=False)
        engine.add_instrument(instrument)
        engine.add_data(bars)
        engine.add_strategy(FrozenIntents())
        engine.run()
        result=engine.get_result()
        fills=engine.trader.generate_order_fills_report()
        accounts=engine.trader.generate_account_report(Venue('WOLF'))
        positions=engine.trader.generate_positions_report()
        # JSON serialisation keeps model objects, Decimal and timestamps explicit strings.
        def records(frame):
            return json.loads(frame.reset_index().to_json(orient='records',date_format='iso',default_handler=str))
        return {'engine':'nautilus_trader.backtest.BacktestEngine','version':nautilus_trader.__version__,
            'fills':records(fills),'accounts':records(accounts),'positions':records(positions),
            'stats':{'totalOrders':result.total_orders,'totalPositions':result.total_positions,
                'totalEvents':result.total_events,'pnl':finite_json(result.stats_pnls),'returns':finite_json(result.stats_returns)},
            'assumptions':{'feeBps':data['feeBps'],'fillModel':'Nautilus bar matching','dataVisibleAt':'candle close',
                'liquidity':'OHLCV bar model, not historical CLOB depth','noLookahead':'intents become eligible only after the indexed completed bar', 'latency':'zero latency; market orders may match at that bar close'},
            'warnings':['Historical bar fills are simulations; not venue confirmations or Polymarket-specific settlement.', 'Bar matching omits historical spread, depth, queue position and latency; it can be optimistic. Undefined statistics are null.']}
    finally:
        engine.dispose()

def finite_json(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k:finite_json(v) for k,v in value.items()}
    if isinstance(value, (list, tuple)):
        return [finite_json(v) for v in value]
    return value

OPS={'diagnostics':diagnostics,'forecast':forecast,'classify':classify,'replay':replay}
for line in sys.stdin:
    request=None
    try:
        if len(line)>1_000_000:
            raise ValueError('WORKER_INPUT_TOO_LARGE')
        request=json.loads(line)
        started=time.monotonic()
        with contextlib.redirect_stdout(sys.stderr):
            result=OPS[request['operation']](request.get('input',{}))
        response={'id':request['id'],'ok':True,'result':result,'elapsedMs':round((time.monotonic()-started)*1000,2)}
        print(json.dumps(response,allow_nan=False,default=str),flush=True)
    except Exception as error:
        print(json.dumps({'id':request.get('id') if isinstance(request,dict) else None,'ok':False,
            'error':{'code':type(error).__name__,'message':str(error)[:600]}}),flush=True)
