import { storeContract } from '@searchkeep/core/testing';
import { D1Store } from '../src/store.js';
import { freshD1 } from './helpers.js';

storeContract('D1', async () => new D1Store(await freshD1()));
