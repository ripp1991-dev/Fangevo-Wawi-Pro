import { loadConfig } from './config';
import { createApp } from './bootstrap';
import { EventDispatcher } from './core/events/dispatcher.service';

const config = loadConfig();
const app = await createApp(config);
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
if (config.dispatchInline) app.get(EventDispatcher).start();
