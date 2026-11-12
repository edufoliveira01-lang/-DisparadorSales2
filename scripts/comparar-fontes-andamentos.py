#!/usr/bin/env python3
"""
Compara as fontes gratuitas de andamento processual para uma lista de processos reais:
  - DJEN (Comunica PJe): publicações/intimações
  - DataJud (CNJ): movimentos (precisa da chave pública do CNJ)
  - PDPJ (opcional, via juscraper): movimentos de todo o Brasil, com o login gov.br do advogado

Rode NO SERVIDOR DO ESCRITÓRIO (no Brasil: os sites do governo bloqueiam IPs de fora).
Nada é gravado no sistema; só imprime e salva um CSV.

  pip install requests            # e, para o PDPJ:  pip install "juscraper[govbr]"
  export DATAJUD_KEY='...'        # a mesma chave de Configurações → DataJud (não cole no chat)
  python3 comparar-fontes-andamentos.py processos.txt [--pdpj]

processos.txt: um número CNJ por linha (com ou sem pontuação).
PDPJ: faça o login uma vez numa máquina com navegador (python3 -c "import juscraper as j; j.scraper('jusbr').auth_govbr()")
e copie ~/.config/juscraper/pdpj_token.json para o mesmo caminho no servidor.
"""
import csv, os, re, sys, time
import requests

UF = {"01":"ac","02":"al","03":"ap","04":"am","05":"ba","06":"ce","07":"dft","08":"es","09":"go","10":"ma","11":"mt","12":"ms","13":"mg","14":"pa","15":"pb","16":"pr","17":"pe","18":"pi","19":"rj","20":"rn","21":"rs","22":"ro","23":"rr","24":"sc","25":"se","26":"sp","27":"to"}

def digitos(n): return re.sub(r"\D", "", n)
def formatar(d): return f"{d[:7]}-{d[7:9]}.{d[9:13]}.{d[13]}.{d[14:16]}.{d[16:]}"

def alias_datajud(d):
    """J.TR do número CNJ -> alias da API pública do DataJud."""
    j, tr = d[13], d[14:16]
    if j == "8": return f"tj{UF[tr]}" if tr in UF else None
    if j == "4": return f"trf{int(tr)}" if 1 <= int(tr) <= 6 else None
    if j == "5": return f"trt{int(tr)}" if 1 <= int(tr) <= 24 else None
    if j == "6": return f"tre-{UF[tr]}" if tr in UF else None
    if j == "7": return "tjmmg" if tr == "13" else None
    if j == "3": return "stj" if tr == "00" else None
    if j == "1": return "stf" if tr == "00" else None
    return None

def djen(d):
    t0 = time.time()
    r = requests.get("https://comunicaapi.pje.jus.br/api/v1/comunicacao", params={"numeroProcesso": d, "itensPorPagina": 20}, timeout=40)
    r.raise_for_status()
    itens = r.json().get("items") or []
    datas = sorted(i.get("data_disponibilizacao") or i.get("datadisponibilizacao") or "" for i in itens)
    return {"achou": bool(itens), "qtd": len(itens), "ultimo": (datas[-1] if datas else ""), "seg": round(time.time() - t0, 1)}

def datajud(d, chave):
    a = alias_datajud(d)
    if not a: raise RuntimeError("tribunal sem alias no DataJud")
    t0 = time.time()
    r = None
    for espera in (0, 8, 20):  # o DataJud público limita o ritmo (429) e às vezes demora: tenta de novo com pausa
        time.sleep(espera)
        try:
            r = requests.post(f"https://api-publica.datajud.cnj.jus.br/api_publica_{a}/_search", headers={"Authorization": f"APIKey {chave}", "Content-Type": "application/json"},
                              json={"size": 5, "query": {"match": {"numeroProcesso": d}}}, timeout=60)
        except requests.exceptions.RequestException:
            r = None; continue
        if r.status_code != 429: break
    if r is None: raise RuntimeError("DataJud não respondeu (demora) nas 3 tentativas")
    r.raise_for_status()
    hits = r.json().get("hits", {}).get("hits", [])
    movs = [m for h in hits for m in (h.get("_source", {}).get("movimentos") or [])]
    datas = sorted(m.get("dataHora", "") for m in movs)
    return {"achou": bool(hits), "qtd": len(movs), "ultimo": (datas[-1] if datas else ""), "seg": round(time.time() - t0, 1)}

def pdpj(d, cliente):
    t0 = time.time()
    df = cliente.movimentos(formatar(d))
    cols = [c for c in df.columns if "data" in c.lower()]
    datas = sorted(str(x) for x in df[cols[0]].dropna().tolist()) if cols and len(df) else []
    return {"achou": len(df) > 0, "qtd": len(df), "ultimo": (datas[-1] if datas else ""), "seg": round(time.time() - t0, 1)}

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args: sys.exit(__doc__)
    nums = [digitos(l) for l in open(args[0], encoding="utf-8") if len(digitos(l)) == 20]
    chave = os.environ.get("DATAJUD_KEY", "").strip()
    cliente = None
    if "--pdpj" in sys.argv:
        import juscraper as jus
        cliente = jus.scraper("pdpj")
    linhas = []
    for d in nums:
        linha = {"processo": formatar(d)}
        for nome, fn in (("djen", lambda: djen(d)), ("datajud", (lambda: datajud(d, chave)) if chave else None), ("pdpj", (lambda: pdpj(d, cliente)) if cliente else None)):
            if fn is None: continue
            try: r = fn()
            except Exception as e: r = {"achou": "", "qtd": "", "ultimo": "", "seg": "", "erro": str(e)[:120]}
            for k, v in r.items(): linha[f"{nome}_{k}"] = v
        linhas.append(linha); print(linha); time.sleep(2)  # pausa entre processos (respeita o limite das APIs públicas)
    campos = sorted({k for l in linhas for k in l}, key=lambda k: (k != "processo", k))
    with open("comparacao-andamentos.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=campos, delimiter=";"); w.writeheader(); w.writerows(linhas)
    print(f"\nPronto: {len(linhas)} processo(s). Planilha: comparacao-andamentos.csv (compare a coluna *_ultimo de cada fonte: a que tiver a data mais recente é a mais atualizada).")

if __name__ == "__main__": main()
