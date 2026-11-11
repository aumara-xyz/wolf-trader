import { Context } from '../runtime-vendor/cordis.mjs';

/** The actual X6 Cordis lifecycle; dependent scopes unload when a service goes away. */
export async function composeWolf({markets,ledger,aukora,providers,intelligence,autonomy}) {
  const ctx=new Context(),fibers=[];
  const provide=async(name,value,inject=[])=>{
    const plugin={name:`wolf-${name}`,inject,apply(scope){scope.provide(name,value);}};
    const fiber=await ctx.plugin(plugin);fibers.push({name,fiber});return fiber;
  };
  await provide('wolfMarkets',markets);
  await provide('wolfLedger',ledger,['wolfMarkets']);
  await provide('wolfMemory',aukora);
  await provide('wolfProviders',providers);
  await provide('wolfIntelligence',intelligence,['wolfMarkets','wolfMemory','wolfProviders']);
  await provide('wolfAutonomy',autonomy,['wolfMarkets','wolfLedger','wolfMemory','wolfIntelligence']);
  const monitor=await ctx.inject(['wolfAutonomy'],scope=>{
    scope.effect(()=>{autonomy.start();return ()=>{autonomy.pause('A required service was stopped.');};},'Stop autonomous decisions when a dependency is lost');
  });
  let closed=false;
  return {
    context:ctx,
    status:()=>({framework:'X6.1 Cordis',sourcePin:'bf21d76952c205bc593f1088d992806e7ad8346f',components:fibers.map(({name})=>({name,available:Boolean(ctx[name])})),intelligenceAuthority:'research-only',moneyAuthority:'deterministic paper governor',hostRuntime:'Node service; selected native Wasm modules'}),
    async close(){if(closed)return;closed=true;await monitor.dispose();for(const {fiber} of fibers.toReversed())await fiber.dispose();},
  };
}
