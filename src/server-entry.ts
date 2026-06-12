import { startWhcToolServer } from "./server";

startWhcToolServer().catch((error) => {
  const message = error instanceof Error ? error.message : "WHC tool server startup failed";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
