type PlaceholderPageProps = {
  title: string;
  summary: string;
};

export function PlaceholderPage({ title, summary }: PlaceholderPageProps) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <p className="text-sm font-medium text-orya-blue">Module à venir</p>
      <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight text-orya-night">
        {title}
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-7 text-orya-night/70">
        {summary}
      </p>
      <div className="orya-card mt-8 border-dashed p-6">
        <p className="font-medium text-orya-night">
          Cette page n&apos;est pas encore fonctionnelle.
        </p>
        <p className="mt-2 text-sm leading-6 text-orya-night/70">
          Aucune donnée n&apos;est enregistrée. Les boutons ou listes
          apparaîtront seulement quand le module correspondant sera réellement
          branché.
        </p>
      </div>
    </main>
  );
}
