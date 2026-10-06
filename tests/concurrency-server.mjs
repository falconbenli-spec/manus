// خادمٌ حقيقي كعملية فرعية لحزام التزامن (TP2.2، المستوى ب). يُنادى من tests/concurrency.test.mjs وحدها.
//   node tests/concurrency-server.mjs <قاعدة> <كلمة المرور>
// يطبع {"port":N} ثم يبقى حتى يُقتل.
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { resolveEnvironment } from '../app/environment.mjs';

const [path, password] = process.argv.slice(2);
const db = openDb(path);
seed(db, password);
// المنفذ صفر: النظام يختار منفذًا حرًّا، فلا يتصادم تشغيلان للحزمة.
const app = createApp(db, { environment: resolveEnvironment({}, { root: process.cwd() }) });
app.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ port: app.address().port }) + '\n');
});
process.on('SIGTERM', () => { app.close(() => { db.close(); process.exit(0); }); });
