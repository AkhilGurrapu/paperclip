import { PUSTAK_WIKI_URL } from "../lib/wiki-tab";

export function WikiFrame() {
  return (
    <div className="h-[calc(100dvh_-_3rem_-_5rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] min-h-[360px] w-full md:h-full md:min-h-0">
      <iframe
        title="InvestSarva Wiki"
        src={PUSTAK_WIKI_URL}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        allow="clipboard-read; clipboard-write"
        className="block h-full w-full border-0 bg-background"
      />
    </div>
  );
}
