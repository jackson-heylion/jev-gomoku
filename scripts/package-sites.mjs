import { cp, mkdir, rm } from 'node:fs/promises';

const workerBuild = 'dist/jev_gomoku';
const serverBuild = 'dist/server';

await rm(serverBuild, { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp(workerBuild, serverBuild, { recursive: true });

await mkdir('dist/.openai', { recursive: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');

console.log('ChatGPT Sites artifact ready: dist/server + dist/client + dist/.openai');
