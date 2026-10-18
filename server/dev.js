import { spawn } from 'node:child_process';
const processes = [spawn(process.execPath,['--watch','server/index.js'],{stdio:'inherit',env:{...process.env,NODE_ENV:'development'}}),spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'})];
for (const child of processes) child.on('exit',code=>{processes.forEach(p=>p.kill());process.exit(code??0);});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{processes.forEach(p=>p.kill());process.exit(0);});
