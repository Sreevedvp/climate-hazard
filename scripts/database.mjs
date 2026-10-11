import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const dbPath=resolve('.data/mongo');
await mkdir(dbPath,{recursive:true});
const server=await MongoMemoryServer.create({binary:{version:'8.0.12'},instance:{port:27017,ip:'127.0.0.1',dbPath,storageEngine:'wiredTiger'}});
console.log(`Local MongoDB: ${server.getUri()} (persistent files: ${dbPath})`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.stop({doCleanup:false,force:false});process.exit(0);});
