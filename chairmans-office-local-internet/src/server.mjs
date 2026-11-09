import 'dotenv/config';
import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 10000);
createApp().listen(port, '0.0.0.0', () => {
  console.log(`Chairman's Office Milestone A listening on port ${port}`);
});
