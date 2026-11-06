import { main } from './cli.js';

process.exitCode = await main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e);
  return 3;
});
