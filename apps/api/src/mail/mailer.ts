import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * F01 (t87u) : envoi d'e-mails transactionnels independant du fournisseur.
 * Aucun fournisseur n'est choisi (decision Ayoub) : aucun envoi reel n'est simule.
 *  - developpement / tests : OutboxFileMailer ecrit chaque message dans un fichier JSON
 *    d'un dossier local (MAIL_OUTBOX_DIR), lu par les tests ; jamais en production ;
 *  - production sans fournisseur configure : DisabledMailer, configured=false. Les
 *    fonctions qui exigent un e-mail (reinitialisation) echouent FERME (503), sans
 *    rien emettre ni rien journaliser du destinataire.
 * Un futur fournisseur implemente Mailer et se branche dans createMailer().
 */
export type MailMessage = { to: string; subject: string; text: string; kind: string };

export interface Mailer {
  readonly name: string;
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol("MAILER");

export class MailerNotConfiguredError extends Error {
  constructor() {
    super("Aucun fournisseur d'e-mail configure.");
    this.name = "MailerNotConfiguredError";
  }
}

/** Boite d'envoi locale (dev/test) : un fichier par message, jamais de console. */
export class OutboxFileMailer implements Mailer {
  readonly name = "outbox";
  readonly configured = true;

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  send(message: MailMessage): Promise<void> {
    const file = join(this.dir, `${Date.now()}-${randomUUID()}.json`);
    writeFileSync(file, JSON.stringify({ ...message, createdAt: new Date().toISOString() }), { encoding: "utf8", mode: 0o600 });
    return Promise.resolve();
  }
}

/** Production sans fournisseur : refuse tout envoi (echec ferme). */
export class DisabledMailer implements Mailer {
  readonly name = "none";
  readonly configured = false;

  send(): Promise<void> {
    return Promise.reject(new MailerNotConfiguredError());
  }
}

/**
 * Choix de l'adaptateur selon l'environnement :
 *  - NODE_ENV=production : MAIL_PROVIDER doit designer un fournisseur implemente ; aucun
 *    ne l'est encore, donc DisabledMailer (la boite locale est refusee en production) ;
 *  - sinon : OutboxFileMailer (MAIL_OUTBOX_DIR, defaut <tmp>/orya-mail-outbox).
 */
export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  if (env.NODE_ENV === "production") {
    return new DisabledMailer();
  }
  return new OutboxFileMailer(env.MAIL_OUTBOX_DIR || join(tmpdir(), "orya-mail-outbox"));
}