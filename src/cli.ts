import { main } from "./main"

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
