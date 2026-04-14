import 'dotenv/config';
import { getNextTaskId, getTask, marketAddress } from '../server/lib/market.js';

async function main() {
  console.log(`Market: ${marketAddress}`);
  const next = await getNextTaskId();
  console.log(`nextTaskId: ${next}`);
  for (let id = 1n; id < next; id++) {
    const t = await getTask(id);
    console.log(`  #${t.id} status=${t.status} type=${t.taskType} poster=${t.poster.slice(0, 10)}… assignee=${t.assignee.slice(0, 10)}…`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
