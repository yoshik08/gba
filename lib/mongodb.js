import { MongoClient } from 'mongodb';

let clientPromise;

function getClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined');
  }
  if (!clientPromise) {
    const client = new MongoClient(uri);
    clientPromise = client.connect();
  }
  return clientPromise;
}

export async function getDatabase() {
  const client = await getClient();
  const db = client.db('gba');
  if (!global.__gbaIndexesReady) {
    await db.collection('sram').createIndex({ userSub: 1, romId: 1 }, { unique: true });
    await db.collection('states').createIndex({ userSub: 1, romId: 1, createdAt: -1 });
    await db.collection('roms').createIndex({ driveFileId: 1 }, { unique: true });
    global.__gbaIndexesReady = true;
  }
  return db;
}
