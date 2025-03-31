import { Arweave, ArweaveSigner } from "@dha-team/arbundles";
import { WALLET } from "./config.js";
import { AOProcess, ARIO, ARIO_TESTNET_PROCESS_ID, createAoSigner } from "@ar.io/sdk";

const signer = new ArweaveSigner(WALLET);
const arweave = Arweave.init({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
});

const ario = ARIO.init({
  process: new AOProcess({
    processId: ARIO_TESTNET_PROCESS_ID,
    // TODO: SUPPORT latest ao connect in ar-io-sdk
  }),
  signer: createAoSigner(signer)
});

export { signer, arweave, ario };
