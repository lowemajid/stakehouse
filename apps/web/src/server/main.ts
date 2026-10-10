import { createApp } from './app';
import { bootOps, bootStore } from './store';

const port = Number(process.env.PORT ?? 3000);

const store = bootStore();
createApp({ store, ops: bootOps(store) }).listen(port, () => {
  console.log(`stakehouse listening → http://localhost:${port}`);
});
