import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createWolfClient, WolfApiError, type WolfClient } from './api'
import { WolfSurface } from './WolfSurface'
import { IntelligencePortals } from './IntelligencePortals'
import { extractHostResearchReferences, resolveHostResearch, validateResolvedHostMarket } from '../wolf-core/host-research.mjs'
import type { Activity, Draft, Market, Portfolio, Quote } from './types'
const initialDraft = (m: Market): Draft => ({ assetId: m.outcomes[0]?.assetId ?? '', side: 'BUY', amount: '25', quantity: '' })
const errorText = (e: unknown) => e instanceof Error ? e.message : 'That request could not finish. Please retry.'
const pendingSaved = () => { try { return localStorage.getItem('wolf.pending.v1') } catch { return null } }
const savePending = (id: string | null) => { try { if (id) localStorage.setItem('wolf.pending.v1', id); else localStorage.removeItem('wolf.pending.v1') } catch { /* Service still owns the durable operation. */ } }
const presentation = () => { try { return JSON.parse(localStorage.getItem('wolf.presentation.v1') ?? '{}') } catch { return {} } }
export interface AskAumaRequest { message: string; marketId?: string }
export interface WolfContext { capitalMode: 'DEMO'; selectedMarketId: string | null; selectedAssetId: string | null; selectedOutcome: string | null; selectedMarket: Market | null; portfolio: Portfolio | null; operationPending: boolean }
export interface WolfAppProps { onAskAuma?: (request: AskAumaRequest) => void | Promise<void>; onContextChange?: (context: WolfContext) => void; apiBase?: string; client?: WolfClient }
export interface WolfAppHandle { applyResearch(result: unknown): Promise<void>; openMarket(marketId: string, assetId?: string): Promise<void>; refresh(): void; getContext(): WolfContext }
/** One app pane. The host owns the conversation, model and Spatial shell. */
export const WolfApp = forwardRef<WolfAppHandle, WolfAppProps>(function WolfApp({ onAskAuma, onContextChange, apiBase, client: hostClient }, ref) {
  const [client] = useState(() => hostClient ?? createWolfClient(apiBase)), [initial] = useState(presentation)
  const [markets, setMarkets] = useState<Market[]>([]), [portfolio, setPortfolio] = useState<Portfolio | null>(null), [activity, setActivity] = useState<Activity[]>([])
  const [expanded, setExpanded] = useState<string | null>(initial.expanded ?? null), [drafts, setDrafts] = useState<Record<string, Draft>>(initial.drafts ?? {})
  const [quotes, setQuotes] = useState<Record<string, Quote | undefined>>({}), [quoteErrors, setQuoteErrors] = useState<Record<string, string | undefined>>({})
  const [quoting, setQuoting] = useState<string | null>(null), [committing, setCommitting] = useState<string | null>(null), [pendingOperation, setPendingOperation] = useState<string | null>(pendingSaved)
  const [now, setNow] = useState(Date.now()), [dataState, setDataState] = useState<'loading' | 'live' | 'stale' | 'offline'>('loading')
  const [marketError, setMarketError] = useState(''), [serviceError, setServiceError] = useState(''), [notice, setNotice] = useState('')
  const [loadingMore, setLoadingMore] = useState(false), [resetOpen, setResetOpen] = useState(false), [resetBusy, setResetBusy] = useState(false)
  const [findings, setFindings] = useState<Record<string, { relevance?: string; countercase?: string }>>(initial.findings ?? {})
  const hostResearchAbort = useRef<AbortController | null>(null), hostOpenAbort = useRef<AbortController | null>(null)
  const quoteAbort = useRef<AbortController | null>(null), quoteGeneration = useRef(0), commitLock = useRef(false)
  const marketRef = useRef(markets); marketRef.current = markets
  const draftsRef = useRef(drafts); draftsRef.current = drafts
  const portfolioRef = useRef(portfolio); portfolioRef.current = portfolio
  const mergeMarkets = useCallback((incoming: Market[]) => {
    const valid = incoming.filter(m => m && typeof m.id === 'string' && typeof m.question === 'string' && Array.isArray(m.outcomes))
    setMarkets(previous => { const byId = new Map(valid.map(m => [m.id, m])), existing = new Set(previous.map(m => m.id)); return [...previous.map(m => byId.get(m.id) ?? m), ...valid.filter(m => !existing.has(m.id))] })
    setDrafts(previous => { const next = { ...previous }; for (const m of valid) if (!next[m.id]) next[m.id] = initialDraft(m); return next })
  }, [])
  const loadPortfolio = useCallback(async () => {
    const [next, history] = await Promise.all([client.request<Portfolio>('portfolio'), client.request<{ items: Activity[] }>('activity')])
    if (!next.account || !Array.isArray(next.positions)) throw new Error('Wolf could not read the demo account.')
    setPortfolio(next); setActivity(history.items ?? []); setServiceError('')
  }, [client])
  const refreshMarkets = useCallback(async (count = 3) => {
    try { const value = await client.request<{ markets: Market[] }>(`markets?limit=${count}`); mergeMarkets(value.markets ?? []); setDataState('live'); setMarketError('') }
    catch (e) { setDataState(navigator.onLine ? 'stale' : 'offline'); setMarketError(errorText(e)) }
  }, [client, mergeMarkets])
  const refresh = useCallback(() => {
    void refreshMarkets(Math.max(3, marketRef.current.length)); void loadPortfolio().catch(e => setServiceError(errorText(e)))
  }, [client, loadPortfolio, refreshMarkets])
  useEffect(() => { refresh(); const clock = setInterval(() => setNow(Date.now()), 1000), timer = setInterval(() => { void refreshMarkets(Math.max(3, marketRef.current.length)) }, 60000); return () => { clearInterval(clock); clearInterval(timer); quoteAbort.current?.abort(); hostResearchAbort.current?.abort(); hostOpenAbort.current?.abort() } }, [refresh, refreshMarkets])
  useEffect(() => { try { localStorage.setItem('wolf.presentation.v1', JSON.stringify({ expanded, drafts, findings, marketIds: markets.map(m => m.id) })) } catch { /* Only presentation state. */ } }, [expanded, drafts, findings, markets])
  useEffect(() => { const offline = () => setDataState('offline'), online = () => refresh(); window.addEventListener('offline', offline); window.addEventListener('online', online); return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online) } }, [refresh])
  const getContext = useCallback((): WolfContext => {
    const market = markets.find(item => item.id === expanded) ?? null
    const outcome = market?.outcomes.find(item => item.assetId === drafts[market.id]?.assetId) ?? null
    return structuredClone({ capitalMode: 'DEMO', selectedMarketId: market?.id ?? null, selectedAssetId: outcome?.assetId ?? null, selectedOutcome: outcome?.name ?? null, selectedMarket: market, portfolio, operationPending: Boolean(pendingOperation || committing) })
  }, [expanded, markets, drafts, portfolio, pendingOperation, committing])
  const contextCallback = useRef(onContextChange); contextCallback.current = onContextChange
  useEffect(() => { contextCallback.current?.(getContext()) }, [getContext])
  useEffect(() => {
    let active = true
    const ids: string[] = Array.isArray(initial.marketIds) ? initial.marketIds.filter((id: unknown): id is string => typeof id === 'string' && /^\d{1,100}$/.test(id)).slice(0, 30) : []
    if (ids.length) void Promise.allSettled(ids.map(async id => validateResolvedHostMarket(await client.request<Market>(`market?id=${encodeURIComponent(id)}`), id) as Market)).then(results => {
      if (active) mergeMarkets(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []))
    })
    return () => { active = false }
  }, [client, initial, mergeMarkets])
  const requestQuote = useCallback(async (marketId: string) => {
    const market = marketRef.current.find(m => m.id === marketId), draft = draftsRef.current[marketId]
    if (!market || !draft || market.supported === false || market.closed || market.acceptingOrders === false || commitLock.current) return
    quoteAbort.current?.abort(); const abort = new AbortController(); quoteAbort.current = abort; const generation = ++quoteGeneration.current
    setQuotes(p => ({ ...p, [marketId]: undefined })); setQuoteErrors(p => ({ ...p, [marketId]: undefined }))
    const amount = draft.side === 'BUY' ? draft.amount : draft.quantity
    if (!/^\d+(\.\d+)?$/.test(amount) || !/[1-9]/.test(amount)) { setQuoting(null); setQuoteErrors(p => ({ ...p, [marketId]: 'Enter a positive amount to see a quote.' })); return }
    setQuoting(marketId)
    try { const result = await client.request<{ quote: Quote }>('preview', { marketId, assetId: draft.assetId, side: draft.side, ...(draft.side === 'BUY' ? { amount: draft.amount } : { quantity: draft.quantity }) }, abort.signal); if (generation === quoteGeneration.current && !abort.signal.aborted) setQuotes(p => ({ ...p, [marketId]: result.quote })) }
    catch (e) { if (!abort.signal.aborted && generation === quoteGeneration.current) setQuoteErrors(p => ({ ...p, [marketId]: errorText(e) })) }
    finally { if (generation === quoteGeneration.current) setQuoting(null) }
  }, [client])
  const selectedDraft = expanded ? drafts[expanded] : undefined
  useEffect(() => { if (!expanded || !selectedDraft) return; const timer = setTimeout(() => { void requestQuote(expanded) }, 350); return () => { clearTimeout(timer); quoteAbort.current?.abort(); ++quoteGeneration.current; setQuoting(null) } }, [expanded, selectedDraft?.assetId, selectedDraft?.side, selectedDraft?.amount, selectedDraft?.quantity, portfolio?.account.revision, requestQuote])
  const changeDraft = (id: string, patch: Partial<Draft>) => { quoteAbort.current?.abort(); ++quoteGeneration.current; setQuotes(p => ({ ...p, [id]: undefined })); setQuoteErrors(p => ({ ...p, [id]: undefined })); setDrafts(p => ({ ...p, [id]: { ...p[id], ...patch } })) }
  const applyResult = async (result: { portfolio?: Portfolio }, text: string) => { if (result.portfolio?.account) { setPortfolio(result.portfolio); setDrafts(previous => { const next = { ...previous }; for (const [id, draft] of Object.entries(next)) if (draft.side === 'SELL' && !result.portfolio!.positions.some(position => position.assetId === draft.assetId)) next[id] = { ...draft, side: 'BUY', quantity: '' }; return next }); } setQuotes({}); setNotice(text); setPendingOperation(null); savePending(null); await loadPortfolio().catch(e => setServiceError(errorText(e))) }
  const resolveOperation = async (id = pendingOperation) => {
    if (!id) return
    try { const result = await client.request<{ operation?: unknown; portfolio?: Portfolio; found?: boolean; pending?: boolean; status?: string }>(`operation?id=${encodeURIComponent(id)}`); if (result.pending || result.status === 'pending') { setPendingOperation(id); savePending(id); setNotice('Your action is still being checked. It has not been submitted again.'); return } if (result.operation || result.found) await applyResult(result, 'Your simulated action is recorded. The account and activity now show its result.'); else { setPendingOperation(null); savePending(null); setNotice('That action was not recorded. Review a fresh quote before trying again.') } }
    catch (e) { if (e instanceof WolfApiError && e.status === 404) { setPendingOperation(null); savePending(null); setNotice('That action was not recorded. Review a fresh quote before trying again.') } else setServiceError('The result is still unknown. Check again before repeating the action.') }
  }
  useEffect(() => { if (pendingOperation) void resolveOperation(pendingOperation) }, [])
  const commit = async (marketId: string) => {
    const quote = quotes[marketId]
    if (!quote || commitLock.current || pendingOperation || Date.parse(quote.expiresAt) <= Date.now()) return
    commitLock.current = true; setCommitting(marketId); setServiceError(''); setNotice(''); const operationId = crypto.randomUUID(); savePending(operationId)
    try { const result = await client.request<{ portfolio?: Portfolio }>('commitDemo', { quoteId: quote.id, operationId, expectedRevision: quote.accountRevision }); await applyResult(result, `Simulated ${quote.side === 'BUY' ? 'buy' : 'sale'} recorded. Your demo cash and position have been updated.`) }
    catch (e) { if (e instanceof WolfApiError && e.status < 500) { savePending(null); setQuoteErrors(p => ({ ...p, [marketId]: errorText(e) })); setQuotes(p => ({ ...p, [marketId]: undefined })); void loadPortfolio().catch(() => {}) } else { setPendingOperation(operationId); await resolveOperation(operationId) } }
    finally { commitLock.current = false; setCommitting(null); if (!pendingSaved()) setTimeout(() => { void requestQuote(marketId) }, 0) }
  }
  const reset = async () => {
    if (commitLock.current || pendingOperation || !portfolioRef.current) return
    commitLock.current = true; setResetBusy(true); const operationId = crypto.randomUUID(); savePending(operationId)
    try { const a = portfolioRef.current.account; const result = await client.request<{ portfolio?: Portfolio }>('resetDemo', { operationId, expectedRevision: a.revision, expectedEpoch: a.epoch }); await applyResult(result, 'A new demo account is ready with $1,000. Your previous account’s history is preserved.'); setResetOpen(false) }
    catch (e) { if (e instanceof WolfApiError && e.status < 500) { savePending(null); setServiceError(errorText(e)); } else { setPendingOperation(operationId); await resolveOperation(operationId) } }
    finally { commitLock.current = false; setResetBusy(false) }
  }
  const openMarket = async (marketId: string, assetId?: string) => {
    extractHostResearchReferences({ markets: [{ id: marketId }] })
    hostOpenAbort.current?.abort(); const abort = new AbortController(); hostOpenAbort.current = abort
    const response = await client.request<Market>(`market?id=${encodeURIComponent(marketId)}`, undefined, abort.signal)
    const market = validateResolvedHostMarket(response, marketId, { assetId }) as Market
    if (abort.signal.aborted) return
    mergeMarkets([market])
    setDrafts(previous => {
      const existing = previous[marketId] ?? initialDraft(market)
      const selected = assetId ?? (market.outcomes.some(outcome => outcome.assetId === existing.assetId) ? existing.assetId : market.outcomes[0]?.assetId ?? '')
      return { ...previous, [marketId]: { ...existing, assetId: selected, side: 'BUY' } }
    })
    setExpanded(marketId)
  }
  const openPosition = async (marketId: string, assetId: string) => { try { await openMarket(marketId, assetId) } catch (error) { setServiceError(errorText(error)) } }
  const applyResearch = async (input: unknown) => {
    hostResearchAbort.current?.abort(); const abort = new AbortController(); hostResearchAbort.current = abort
    const result = await resolveHostResearch(input, (id: string) => client.request<Market>(`market?id=${encodeURIComponent(id)}`, undefined, abort.signal), { signal: abort.signal } as { signal: AbortSignal; maxMarkets?: number })
    if (abort.signal.aborted) return
    mergeMarkets(result.markets as Market[])
    setFindings(previous => ({ ...previous, ...result.findings }))
    if (result.markets.length) { setDataState('live'); setNotice(`${result.markets.length} ${result.markets.length === 1 ? 'market' : 'markets'} received from Auma and verified with the source.`) }
  }
  useImperativeHandle(ref, () => ({ applyResearch, openMarket, refresh, getContext }))
  const more = async () => { setLoadingMore(true); await refreshMarkets(Math.min(30, marketRef.current.length + 3)); setLoadingMore(false) }
  const explain = async (question: string, marketId: string) => {
    if (!onAskAuma) { setNotice('Open Wolf in AUKORA to discuss this market with Auma.'); return }
    try { await onAskAuma({ message: `Explain exactly what decides this market: ${question}`, marketId }) }
    catch (error) { setServiceError(`Auma could not be opened. ${errorText(error)}`) }
  }
  return <div className="wolf-app-pane wolf-theme"><WolfSurface intelligence={<IntelligencePortals client={client} markets={markets} onMarkets={mergeMarkets}/>} markets={markets} portfolio={portfolio} activity={activity} expanded={expanded} drafts={drafts} quotes={quotes} quoteErrors={quoteErrors} quoting={quoting} committing={committing} pendingOperation={pendingOperation} now={now} dataState={dataState} marketError={marketError} serviceError={serviceError} notice={notice} findings={findings} loadingMore={loadingMore} resetOpen={resetOpen} resetBusy={resetBusy} onToggle={id => { setExpanded(current => current === id ? null : id); setNotice('') }} onDraft={changeDraft} onQuote={id => { void requestQuote(id) }} onCommit={id => { void commit(id) }} onRefresh={refresh} onMore={() => { void more() }} onOpenPosition={(marketId, assetId) => { void openPosition(marketId, assetId) }} onResetOpen={setResetOpen} onReset={() => { void reset() }} onResolve={() => { void resolveOperation() }} onExplain={(question, marketId) => { void explain(question, marketId) }} /></div>
})
