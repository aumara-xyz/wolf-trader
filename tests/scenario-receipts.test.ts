import {describe,expect,it} from 'vitest'
import {createDemoReceipt,verifyDemoReceipt} from '../packages/scenario-lab/receipts'

const payload = () => ({scenario:'fixture:tariff',evidence:'announcement',terms:{capitalMode:'DEMO',maxPerOrder:25},agents:[{role:'critic',abstained:true}],createdAt:'2026-11-15T00:00:00.000Z'})

describe('ephemeral scenario receipts',()=>{
 it('signs a detached snapshot with only an exported public key and verifies it',async()=>{
  const original=payload(),receipt=await createDemoReceipt(original)
  original.terms.maxPerOrder=200
  expect(receipt.payload).toEqual(payload())
  expect(receipt.publicJwk.kty).toBe('EC');expect(receipt.publicJwk.crv).toBe('P-256')
  expect(receipt.publicJwk).not.toHaveProperty('d')
  expect(receipt.publicJwk.key_ops).toEqual(['verify'])
  expect(await verifyDemoReceipt(receipt)).toMatchObject({valid:true})
  expect(JSON.stringify(receipt)).not.toContain('privateKey')
 })
 it('detects changed evidence, financial terms and replaced public keys',async()=>{
  const receipt=await createDemoReceipt(payload())
  const altered=structuredClone(receipt);altered.payload.evidence='confirmed'
  expect(await verifyDemoReceipt(altered)).toMatchObject({valid:false,reason:'The recorded payload has changed.'})
  const terms=structuredClone(receipt);(terms.payload.terms as {maxPerOrder:number}).maxPerOrder=250
  expect((await verifyDemoReceipt(terms)).valid).toBe(false)
  const other=await createDemoReceipt(payload()),keySwap={...receipt,publicJwk:other.publicJwk}
  expect((await verifyDemoReceipt(keySwap)).valid).toBe(false)
 })
 it('verifies independently of JSON field order but preserves array order',async()=>{
  const receipt=await createDemoReceipt({z:1,a:{second:2,first:1},steps:['observed','refused']})
  const reordered={signature:receipt.signature,payloadSha256:receipt.payloadSha256,payload:{steps:['observed','refused'],a:{first:1,second:2},z:1},publicJwk:receipt.publicJwk,algorithm:receipt.algorithm,issuer:receipt.issuer,schema:receipt.schema}
  expect((await verifyDemoReceipt(reordered)).valid).toBe(true)
  reordered.payload.steps.reverse()
  expect((await verifyDemoReceipt(reordered)).valid).toBe(false)
 })
 it('can be independently verified with WebCrypto and a reconstructed canonical envelope',async()=>{
  const receipt=await createDemoReceipt({value:42})
  const message=JSON.stringify({algorithm:receipt.algorithm,issuer:receipt.issuer,payload:{value:42},payloadSha256:receipt.payloadSha256,schema:receipt.schema})
  const key=await crypto.subtle.importKey('jwk',receipt.publicJwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify'])
  const raw=atob(receipt.signature.replaceAll('-','+').replaceAll('_','/')+'==')
  const signature=Uint8Array.from(raw,c=>c.charCodeAt(0))
  expect(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,new TextEncoder().encode(message))).toBe(true)
  const pending=verifyDemoReceipt(receipt)
  receipt.payload.value=100
  expect((await pending).valid).toBe(true)
  expect((await verifyDemoReceipt(receipt)).valid).toBe(false)
 })
 it('rejects forged envelopes, weak algorithms, private key fields and malformed encodings',async()=>{
  const receipt=await createDemoReceipt(payload())
  for(const invalid of [null,[],{...receipt,algorithm:'none'},{...receipt,issuer:'owner permission'},{...receipt,extra:true},{...receipt,publicJwk:{...receipt.publicJwk,d:'secret'}},{...receipt,signature:receipt.signature+'='},{...receipt,payloadSha256:'0'.repeat(64)}])expect((await verifyDemoReceipt(invalid)).valid).toBe(false)
 })
 it('rejects non-JSON structures without invoking accessors',async()=>{
  let read=false
  const getter=Object.defineProperty({},'danger',{enumerable:true,get(){read=true;return 1}})
  const cycle:Record<string,unknown>={};cycle.next=cycle
  const polluted=JSON.parse('{"__proto__":{"polluted":true}}')
  for(const invalid of [[],{value:NaN},{value:Infinity},{value:undefined},{value:new Date()},getter,cycle,polluted,{text:'\ud800'},{text:'\udfff'},{values:new Array(2)}])await expect(createDemoReceipt(invalid as never)).rejects.toThrow('Demo receipt:')
  expect(read).toBe(false)
  expect(({} as {polluted?:boolean}).polluted).toBeUndefined()
 })
 it('bounds Unicode bytes, arrays, depth and verification input',async()=>{
  await expect(createDemoReceipt({text:'🦊'.repeat(16_384)})).rejects.toThrow()
  await expect(createDemoReceipt({values:Array(257).fill(0)})).rejects.toThrow()
  let deep:Record<string,unknown>={}
  for(let i=0;i<16;i++)deep={next:deep}
  await expect(createDemoReceipt(deep as never)).rejects.toThrow()
  const receipt=await createDemoReceipt(payload())
  expect((await verifyDemoReceipt({...receipt,payload:{text:'a'.repeat(100_000)}})).valid).toBe(false)
  // A valid surrogate pair is preserved and signed rather than normalized away.
  expect((await verifyDemoReceipt(await createDemoReceipt({text:'🐺 café'}))).valid).toBe(true)
 })
 it('uses compatible creation and verification bounds at the deepest accepted payload',async()=>{
  let deep:Record<string,unknown>={value:0}
  for(let i=0;i<13;i++)deep={next:deep}
  expect((await verifyDemoReceipt(await createDemoReceipt(deep as never))).valid).toBe(true)
  const nearLimit={a:'a'.repeat(16_000),b:'b'.repeat(16_000),c:'c'.repeat(16_000),d:'d'.repeat(16_000)}
  expect((await verifyDemoReceipt(await createDemoReceipt(nearLimit))).valid).toBe(true)
  const beyondLimit={a:'a'.repeat(16_384),b:'b'.repeat(16_384),c:'c'.repeat(16_384),d:'d'.repeat(16_384)}
  await expect(createDemoReceipt(beyondLimit)).rejects.toThrow('byte limit')
 })
})
