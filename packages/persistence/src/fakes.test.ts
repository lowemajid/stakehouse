import { runRepositoryContract } from './repositoryContract';
import { createFakeStore } from './fakes';

// The fakes are the contract's first subject — the reference behavior every
// real backend must match. No `reopen`: an in-memory store has no on-disk
// state to survive a restart, so the durability gate is skipped here and
// asserted by the SQLite adapter's run instead.
runRepositoryContract({
  name: 'in-memory fakes',
  create: () => createFakeStore(),
});
