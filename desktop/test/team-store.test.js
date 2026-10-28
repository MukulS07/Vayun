const runContract = require('./helpers/team-contract');
const { createMemoryServer } = require('../team-store-memory');
const { FirestoreTeamStore } = require('../team-store-firestore');
const { createFakeFirestore } = require('./helpers/fake-firestore');

runContract('memory store', () => createMemoryServer());

runContract('firestore store (fake server)', () => {
  const fake = createFakeFirestore('p');
  const uidOf = me => (typeof me === 'function' ? me() : me).uid;
  return {
    storeFor: me => new FirestoreTeamStore({ project: 'p', me, getToken: async () => 'tok-' + uidOf(me), fetch: fake.fetch }),
  };
});
