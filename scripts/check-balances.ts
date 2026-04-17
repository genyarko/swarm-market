import 'dotenv/config';
import { loadWallets } from '../server/lib/config.js';
import { getUsdcBalance } from '../server/lib/circle.js';

const wallets = loadWallets();
for (const w of wallets) {
  const bal = await getUsdcBalance(w.id);
  console.log(`  ${w.role.padEnd(11)} ${w.name.padEnd(14)} ${w.address}  ${bal.toFixed(4)} USDC`);
}
