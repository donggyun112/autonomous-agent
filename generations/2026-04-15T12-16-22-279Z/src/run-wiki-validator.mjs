import("./extensions/tools/wiki-validator.ts")
  .then(async module => {
    const fn = typeof module.default === 'function' ? module.default : module.wikiLinkValidator;
    if (typeof fn !== 'function') throw new Error("Not exported as function");
    return await fn();
  }).then(console.log).catch(e => {
    console.error("[Error]", e?.message || String(e));
    process.exitCode = 1;
  });
