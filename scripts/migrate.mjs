import { migrate } from '../lib/migrate.mjs';
import { database } from '../backend/src/db.mjs';
try { await migrate(); console.log('Database migration completed.'); }
finally { await database().end(); }
