import type { WolfClient } from './api'
export interface OwnerKeyStore { get():Promise<CryptoKeyPair|null>; set(pair:CryptoKeyPair):Promise<void> }
const database=()=>new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('wolf.owner.key.v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('identity');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
export const browserOwnerKeyStore:OwnerKeyStore={
  async get(){const db=await database();try{return await new Promise<CryptoKeyPair|null>((resolve,reject)=>{const r=db.transaction('identity').objectStore('identity').get('owner');r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error)})}finally{db.close()}},
  async set(pair){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('identity','readwrite');tx.objectStore('identity').put(pair,'owner');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}}
}
const base64url=(buffer:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
/** Only invoked by explicit owner controls. Keys never enter model requests or exports. */
export async function signOwnerAction(client:WolfClient,action:'enroll'|'grant'|'revoke',payload:Record<string,unknown>={},store:OwnerKeyStore=browserOwnerKeyStore){
  let pair=await store.get()
  const status=await client.request<{enrolled?:boolean;owner?:unknown}>('authority')
  if(!pair){if(status.enrolled)throw new Error('This browser does not hold the enrolled owner key. Use the browser that enrolled it.');pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);await store.set(pair)}
  const publicKeyJwk=await crypto.subtle.exportKey('jwk',pair.publicKey)
  const sign=async(kind:string,body:Record<string,unknown>)=>{
    const challenge=await client.request<{id:string;signingText:string}>('authority/challenge',{action:kind,...body})
    const signature=base64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair!.privateKey,new TextEncoder().encode(challenge.signingText)))
    return client.request<Record<string,unknown>>('authority/complete',{challengeId:challenge.id,signature,...(kind==='enroll'?{publicKeyJwk}:{})})
  }
  if(!status.enrolled){await sign('enroll',{publicKeyJwk});if(action==='enroll')return {enrolled:true}}
  if(action==='enroll')return {enrolled:true}
  return sign(action,payload)
}
export async function signAndArmPaper(client:WolfClient,request:Record<string,unknown>,store?:OwnerKeyStore){
  const prepared=await client.request<{request:Record<string,unknown>;terms:Record<string,unknown>}>('authority/prepare',{request})
  const result=await signOwnerAction(client,'grant',{terms:prepared.terms},store)
  const grant=(result.grant??result) as {id?:string;grantId?:string}
  const grantId=grant.id??grant.grantId
  if(!grantId)throw new Error('The signed permission did not return a grant identity.')
  return client.request('autonomy/arm',{...prepared.request,grantId})
}
