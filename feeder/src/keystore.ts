import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import * as fs from "fs";

interface Entity {
  name: string;
  address: string;
  ciphertext: string;
}

function loadEntities(path: string): Entity[] {
  try {
    return JSON.parse(fs.readFileSync(path, `utf8`) || `[]`);
  } catch (e) {
    console.error("loadKeys", e.message);
    return [];
  }
}

export async function save(
  filePath: string,
  name: string,
  password: string,
  mnemonic: string
): Promise<void> {
  const keys = loadEntities(filePath);

  if (keys.find((key) => key.name === name)) {
    throw new Error("Key already exists by that name");
  }
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: "kujira",
  });
  const [account] = await wallet.getAccounts();
  const ciphertext = await wallet.serialize(password);

  keys.push({
    name,
    address: account.address,
    ciphertext,
  });

  fs.writeFileSync(filePath, JSON.stringify(keys));
}

export function load(
  filePath: string,
  name: string,
  password: string
): Promise<DirectSecp256k1HdWallet> {
  const keys = loadEntities(filePath);
  const key = keys.find((key) => key.name === name);

  if (!key) {
    throw new Error("Cannot load key by that name");
  }

  try {
    return DirectSecp256k1HdWallet.deserialize(key.ciphertext, password);
  } catch (err) {
    throw new Error("Incorrect password");
  }
}
