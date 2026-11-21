import { Global, Logger, Module } from "@nestjs/common";
import { createMailer, MAILER } from "./mailer";

/** F01 (t87u) : fournit l'adaptateur Mailer (voir mailer.ts). */
@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      useFactory: () => {
        const mailer = createMailer();
        if (!mailer.configured) {
          new Logger("Mail").warn("Aucun fournisseur d'e-mail configure : la reinitialisation du mot de passe est indisponible (503).");
        }
        return mailer;
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}