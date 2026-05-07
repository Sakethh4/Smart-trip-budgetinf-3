const { ok } = require("./_utils");
exports.handler = async () => ok({ ok: true, time: new Date().toISOString() });
