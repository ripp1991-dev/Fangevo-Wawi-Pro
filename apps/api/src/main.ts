import { loadConfig } from './config';
import { createApp } from './bootstrap';

const config = loadConfig();
const app = await createApp(config);
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
