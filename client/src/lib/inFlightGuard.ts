export interface InFlightGuard<Key> {
  tryStart: (key: Key) => boolean;
  finish: (key: Key) => void;
  isActive: (key: Key) => boolean;
}

/**
 * Trava síncrona para ações assíncronas disparadas pela interface. Diferente de useState,
 * ela já bloqueia um segundo clique ocorrido antes do próximo render do React.
 */
export function createInFlightGuard<Key>(): InFlightGuard<Key> {
  const active = new Set<Key>();
  return {
    tryStart(key) {
      if (active.has(key)) return false;
      active.add(key);
      return true;
    },
    finish(key) {
      active.delete(key);
    },
    isActive(key) {
      return active.has(key);
    },
  };
}
