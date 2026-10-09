import { createApp } from './app';
import { bootStore } from './store';

const port = Number(process.env.PORT ?? 3000);

createApp({ store: bootStore() }).listen(port, () => {
  console.log(`stakehouse listening → http://localhost:${port}`);
});
