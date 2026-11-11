import type { ReactNode } from 'react'
import { AppHeader, PortalButton, PortalCell, PortalGrid, RecordList, RecordRow, FieldTable, AkIcon } from '../spatial-ui'
import type { Activity, Draft, Market, Portfolio, Quote } from './types'

export const money = (value: unknown) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value))
const cents = (value: string | number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value) * 100)
export const quantity = (value: unknown) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(Number(value)) : '—'
export const sourceUrl = (url?: string) => url?.startsWith('https://') ? url : undefined
const time = (date?: string) => date && Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined

export interface WolfSurfaceProps {
  intelligence?: ReactNode;
  markets: Market[]; portfolio: Portfolio | null; activity: Activity[]; expanded: string | null;
  drafts: Record<string, Draft>; quotes: Record<string, Quote | undefined>; quoteErrors: Record<string, string | undefined>;
  quoting: string | null; committing: string | null; pendingOperation: string | null; now: number;
  dataState: 'loading' | 'live' | 'stale' | 'offline'; marketError: string; serviceError: string; notice: string;
  findings: Record<string, { relevance?: string; countercase?: string }>; loadingMore: boolean;
  resetOpen: boolean; resetBusy: boolean;
  onToggle(id: string): void; onDraft(id: string, patch: Partial<Draft>): void;
  onQuote(id: string): void; onCommit(id: string): void; onRefresh(): void; onMore(): void;
  onOpenPosition(marketId: string, assetId: string): void; onResetOpen(value: boolean): void; onReset(): void; onResolve(): void;
  onExplain(question: string, marketId: string): void;
}

/** Pure presentation. The carrier owns transport, retained drafts and durable domain facts. */
export function WolfSurface(p: WolfSurfaceProps) {
  const positions = p.portfolio?.positions ?? []
  const subtitle = p.dataState === 'live' ? 'Live markets · Paper capital' : p.dataState === 'loading' ? 'Connecting to markets · Demo money' : 'Saved market data · Demo money'
  return <section className="wolf-surface wolf-theme" aria-label="Wolf prediction markets">
    <div className="wolf-lane-header"><AppHeader title="Wolf Trader" eyebrow={subtitle} tone="violet" /></div>
    <div className="wolf-content">
      {p.serviceError && <InlineMessage kind="error">{p.serviceError} <button className="wolf-text-action" onClick={p.onRefresh}>Retry</button></InlineMessage>}
      {p.notice && <div className="wolf-notice" role="status">{p.notice}</div>}
      {p.pendingOperation && <InlineMessage>Checking whether your action was recorded. <button className="wolf-text-action" onClick={p.onResolve}>Check result</button></InlineMessage>}
      <PortalGrid open={false}>
        <PortalCell><PortalButton icon="aumlok" tone="mint" title="Demo balance" summary={p.portfolio ? `${money(p.portfolio.account.cash)} available` : 'Opening your demo account…'} expanded={p.expanded === 'balance'} onToggle={() => p.onToggle('balance')}>
          <p className="wolf-body-text">A place to explore with demo money.</p>
          <FieldTable rows={[
            ['Available demo cash', money(p.portfolio?.account.cash)],
            ['Position sell value', p.portfolio?.estimatedSellValue != null ? money(p.portfolio.estimatedSellValue) : positions.length ? 'Estimate unavailable' : money(0)],
            ['Estimated total', p.portfolio?.estimatedTotal != null ? money(p.portfolio.estimatedTotal) : positions.length ? 'Incomplete · positions need a sell quote' : money(p.portfolio?.account.cash)],
          ]} />
          <p className="wolf-muted">No wallet, deposit or real order is connected.</p>
          {p.resetOpen ? <div className="wolf-reset-review"><p>Start a new demo account with $1,000. Your current account’s history stays saved.</p><div className="wolf-action-row"><button className="wolf-button" disabled={p.resetBusy || !p.portfolio} onClick={p.onReset}>{p.resetBusy ? 'Starting…' : 'Start again with $1,000'}</button><button className="wolf-text-action" onClick={() => p.onResetOpen(false)}>Keep this account</button></div></div> : <button className="wolf-text-action" onClick={() => p.onResetOpen(true)}>Start again</button>}
        </PortalButton></PortalCell>
        <PortalCell><PortalButton icon="archive" tone="blue" title="Your positions" summary={positions.length ? `${positions.length} ${positions.length === 1 ? 'outcome' : 'outcomes'} held` : 'Your next perspective starts here'} expanded={p.expanded === 'positions'} onToggle={() => p.onToggle('positions')}>
          {positions.length ? <RecordList>{positions.map(position => <RecordRow key={position.assetId} tone="blue" title={position.outcome} summary={`${quantity(position.quantity)} shares · ${money(position.costBasis)} cost`}>
            <p className="wolf-body-text">{position.question ?? 'Your market position'}</p><FieldTable rows={[
              ['Estimated sell value', position.estimatedSellValue != null ? money(position.estimatedSellValue) : 'Unavailable'], ['Unrealized change', money(position.unrealizedPnl)], ['Observation', position.markObservedAt ? new Date(position.markObservedAt).toLocaleString() : 'No reliable quote'],
            ]} /><button className="wolf-button" onClick={() => p.onOpenPosition(position.marketId, position.assetId)}>Open position <AkIcon name="out" /></button>
          </RecordRow>)}</RecordList> : <p className="wolf-body-text">Your first demo position will appear here. Open a market below to explore an outcome.</p>}
          <details className="wolf-details"><summary>Activity <span>{p.activity.length}</span></summary><ActivityList items={p.activity} /></details>
        </PortalButton></PortalCell>
      </PortalGrid>
      {p.intelligence}
      <div className="wolf-section-heading"><span>Explore markets</span><button className="wolf-text-action" onClick={p.onRefresh} aria-label="Refresh live markets">Refresh <span aria-hidden="true">↻</span></button></div>
      {p.dataState === 'loading' && !p.markets.length ? <div className="wolf-loading" aria-live="polite"><span className="wolf-orbit"><AkIcon name="aura" /></span>Finding real markets…</div> : null}
      {p.marketError && <InlineMessage kind="error">{p.marketError} <button className="wolf-text-action" onClick={p.onRefresh}>Try again</button></InlineMessage>}
      {!p.markets.length && p.dataState !== 'loading' && !p.marketError ? <p className="wolf-empty">No matching markets right now. Try a broader topic with Auma.</p> : null}
      <PortalGrid open={true}>{p.markets.map((market, index) => {
        const draft = p.drafts[market.id] ?? { assetId: market.outcomes[0]?.assetId ?? '', side: 'BUY', amount: '25', quantity: '' }
        const owned = positions.filter(position => position.marketId === market.id)
        const selected = market.outcomes.find(outcome => outcome.assetId === draft.assetId) ?? market.outcomes[0]
        const holding = owned.find(position => position.assetId === selected?.assetId)
        const quote = p.quotes[market.id]
        const expired = !quote || Date.parse(quote.expiresAt) <= p.now
        const busy = p.committing === market.id
        const unsupported = market.supported === false || market.closed || market.acceptingOrders === false
        const prices = market.outcomes.map(outcome => outcome.price == null ? outcome.name : `${outcome.name} ${cents(outcome.price)}¢`).join(' · ')
        const summary = owned.length ? `You hold ${owned.map(position => position.outcome).join(' and ')} · ${owned.map(position => quantity(position.quantity)).join(' / ')} shares` : prices || 'Public market · open to explore'
        const findings = p.findings[market.id]
        return <PortalCell key={market.id} data-market-id={market.id}><PortalButton icon={owned.length ? 'archive' : 'risk'} tone={owned.length ? 'mint' : index % 3 === 1 ? 'violet' : 'blue'} title={market.question} summary={summary} expanded={p.expanded === market.id} onToggle={() => p.onToggle(market.id)}>
          <div className="wolf-market-intro"><h3>{market.question}</h3><p>{shortRule(market.rules ?? market.description)}</p><div className="wolf-source-line">{sourceUrl(market.url) ? <a href={sourceUrl(market.url)} target="_blank" rel="noreferrer">Polymarket <AkIcon name="out" /></a> : <span>Polymarket</span>}<span>{market.closed ? 'Trading closed' : market.acceptingOrders === false ? 'Not accepting trades' : 'Public market'}</span></div></div>
          <fieldset className="wolf-outcomes"><legend>Choose an outcome</legend>{market.outcomes.map(outcome => <button type="button" key={outcome.assetId} className="wolf-choice" aria-pressed={selected?.assetId === outcome.assetId} disabled={busy} onClick={() => p.onDraft(market.id, { assetId: outcome.assetId, side: 'BUY', quantity: '' })}><span>{outcome.name}</span>{outcome.price != null && <span className="wolf-outcome-price">{cents(outcome.price)}¢</span>}</button>)}</fieldset>
          {holding && <p className="wolf-holding">You hold <strong>{quantity(holding.quantity)} {holding.outcome} shares</strong><span>{money(holding.costBasis)} total cost</span></p>}
          {unsupported ? <InlineMessage>{market.closed ? 'Trading closed. Your position remains here while the market resolves.' : `Browse only. ${market.unsupportedReasons?.join(' ') || 'This market’s trading rules are not supported yet.'}`}</InlineMessage> : <>
            {holding && <div className="wolf-segment" aria-label="Position action"><button aria-pressed={draft.side === 'BUY'} onClick={() => p.onDraft(market.id, { side: 'BUY' })} disabled={busy}>Add more</button><button aria-pressed={draft.side === 'SELL'} onClick={() => p.onDraft(market.id, { side: 'SELL', quantity: holding.quantity })} disabled={busy}>Reduce</button><button onClick={() => p.onDraft(market.id, { side: 'SELL', quantity: holding.quantity })} disabled={busy}>Cash out</button></div>}
            <div className="wolf-amount-block"><label htmlFor={`amount-${market.id}`}>{draft.side === 'BUY' ? 'Spend demo cash' : 'Shares to sell'}</label><div className="wolf-amount-input">{draft.side === 'BUY' && <span aria-hidden="true">$</span>}<input id={`amount-${market.id}`} inputMode="decimal" autoComplete="off" value={draft.side === 'BUY' ? draft.amount : draft.quantity} onChange={event => p.onDraft(market.id, draft.side === 'BUY' ? { amount: event.target.value } : { quantity: event.target.value })} disabled={busy} aria-describedby={`amount-note-${market.id}`} /><span>{draft.side === 'BUY' ? 'USD' : 'shares'}</span></div><div className="wolf-amount-meta" id={`amount-note-${market.id}`}><span>{draft.side === 'BUY' ? `${money(p.portfolio?.account.cash)} available · fees included` : `${quantity(holding?.quantity ?? 0)} shares available`}</span><div className="wolf-presets">{draft.side === 'BUY' ? ['10', '25', '50'].map(value => <button key={value} disabled={busy} onClick={() => p.onDraft(market.id, { amount: value })}>${value}</button>) : holding && [25, 50, 100].map(value => <button key={value} disabled={busy} onClick={() => p.onDraft(market.id, { quantity: fraction(holding.quantity, value, market.quantityStep ?? '0.01') })}>{value === 100 ? 'All' : `${value}%`}</button>)}</div></div></div>
            {p.quoting === market.id ? <p className="wolf-quote-status" role="status">Reading the order book…</p> : p.quoteErrors[market.id] ? <InlineMessage kind="error">{p.quoteErrors[market.id]}</InlineMessage> : quote ? <div className="wolf-quote-preview"><div><span>{draft.side === 'BUY' ? 'You receive' : 'Estimated proceeds'}</span><strong>{draft.side === 'BUY' ? `${quantity(quote.quantity)} shares` : money(quote.proceeds)}</strong></div><div><span>{draft.side === 'BUY' ? 'Total debit' : 'Shares sold'}</span><strong>{draft.side === 'BUY' ? money(quote.debit) : quantity(quote.quantity)}</strong></div>{draft.side === 'BUY' && <><div><span>If this outcome wins</span><strong>{money(quote.quantity)}<small> includes your stake</small></strong></div><div><span>Maximum loss</span><strong>{money(quote.debit)}</strong></div></>}<div><span>Modeled fees</span><strong>{money(quote.fee ?? 0)}</strong></div></div> : null}
            <div className="wolf-submit-area">{(quote && expired) || (!quote && p.quoting !== market.id) ? <button className="wolf-button wolf-button-primary" onClick={() => p.onQuote(market.id)} disabled={busy}>Refresh quote</button> : <button className="wolf-button wolf-button-primary" disabled={!quote || expired || busy || Boolean(p.pendingOperation) || p.quoting === market.id} onClick={() => p.onCommit(market.id)}>{busy ? 'Recording…' : draft.side === 'BUY' ? `${holding ? 'Add' : 'Try'} ${money(quote?.debit ?? draft.amount)} on ${selected?.name ?? 'outcome'}` : `Sell ${quantity(quote?.quantity ?? draft.quantity)} ${selected?.name ?? ''} shares`}</button>}<p>{quote && !expired ? `Quote valid for ${Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - p.now) / 1000))}s` : quote ? 'Quote expired. Read a fresh book to continue.' : 'A valid live quote is needed.'}<span>Simulated fill · no real money</span></p></div>
          </>}
          <details className="wolf-details"><summary>Why this market?</summary><p>{findings?.relevance || 'A real public prediction market available to explore. Auma can help explain its rules and find relevant evidence.'}</p><p className="wolf-muted">{findings?.countercase || 'The market price is not a promise or Auma’s probability estimate. The full purchase cost can be lost.'}</p><button className="wolf-text-action" onClick={() => p.onExplain(market.question, market.id)}>Ask Auma to explain</button></details>
          <details className="wolf-details"><summary>Market details and rules</summary><p className="wolf-full-rules">{market.rules ?? market.description ?? 'Read the market source for its full resolution rules.'}</p><FieldTable rows={[
            ['Data source', sourceUrl(market.url) ? <a href={sourceUrl(market.url)} target="_blank" rel="noreferrer">Polymarket</a> : 'Polymarket'],
            ['Protocol', market.protocolVersion ?? 'Source supplied'], ['Fees', market.fee?.known ? market.fee.model ?? 'Verified fee model' : 'Unverified · trading unavailable'],
            ['Closes', (market.endDate ?? market.closeTime) ? new Date((market.endDate ?? market.closeTime)!).toLocaleString() : 'See resolution rules'],
            ['Market observed', (market.observedAt ?? market.receivedAt ?? market.fetchedAt) ? new Date((market.observedAt ?? market.receivedAt ?? market.fetchedAt)!).toLocaleString() : 'See source timestamps'],
            ['Quote created', quote?.createdAt ? new Date(quote.createdAt).toLocaleString() : 'No current quote'],
            ['Settlement', 'Final supported resolution only'], ['Quote model', 'Buy asks · sell bids · full quantity or none'],
          ]} /></details>
        </PortalButton></PortalCell>
      })}</PortalGrid>
      {p.markets.length > 0 && <button className="wolf-more" disabled={p.loadingMore} onClick={p.onMore}>{p.loadingMore ? 'Finding more markets…' : 'Show more markets'} <span aria-hidden="true">+</span></button>}
      <p className="wolf-bottom-note">Public prediction markets. Demo positions. Your decisions stay yours.</p>
    </div>
  </section>
}

function shortRule(rule?: string) { return rule ? rule.length > 220 ? `${rule.slice(0, 217).trim()}…` : rule : 'Explore the outcomes and read the source’s resolution rules before taking a demo position.' }
/** Exact decimal shares scaled using integers, never binary float arithmetic. */
function fraction(value: string, percent: number, step: string) {
  const [whole, decimal = ''] = value.split('.')
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(decimal)) return value
  const [stepWhole, stepDecimal = ''] = step.split('.')
  const scale = Math.max(decimal.length, stepDecimal.length, 6)
  const stepUnits = /^\d+$/.test(stepWhole) && /^\d*$/.test(stepDecimal) ? BigInt(stepWhole + stepDecimal.padEnd(scale, '0')) : 10000n
  const raw = BigInt(whole + decimal.padEnd(scale, '0')) * BigInt(percent) / 100n
  const units = stepUnits > 0n ? raw / stepUnits * stepUnits : raw
  const text = units.toString().padStart(scale + 1, '0')
  return `${text.slice(0, -scale)}.${text.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '')
}
export function InlineMessage({ children, kind }: { children: ReactNode; kind?: 'error' }) { return <div className={`wolf-inline-message ${kind === 'error' ? 'is-error' : ''}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div> }

function ActivityList({ items }: { items: Activity[] }) {
  return items.length ? <RecordList>{items.slice(0, 25).map((item, index) => <RecordRow key={item.id ?? item.operationId ?? String(index)} tone="mint" title={item.side === 'BUY' ? 'Simulated buy' : item.side === 'SELL' ? 'Simulated sale' : item.kind === 'funding' || item.type === 'funding' || item.type === 'demo.funding' ? 'Demo account funded' : 'Demo account activity'} summary={[item.outcome, item.quantity && `${quantity(item.quantity)} shares`, time(item.createdAt ?? item.at)].filter(Boolean).join(' · ')}>
    {item.question && <p>{item.question}</p>}<FieldTable rows={[
      ['Recorded as', 'Simulation'], ...(item.debit != null ? [['Debit', money(item.debit)] as const] : []), ...(item.proceeds != null ? [['Proceeds', money(item.proceeds)] as const] : []), ...(item.fee != null ? [['Fees', money(item.fee)] as const] : []),
    ]} />
  </RecordRow>)}</RecordList> : <p className="wolf-muted">Your simulated actions will appear here.</p>
}
