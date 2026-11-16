import { afterAll, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { aceitarSugestao, caixaValida, descartarSugestao, fotoSugeridaDaPessoa, sugerirFotoDoDocumento } from "../src/services/gestao/fotoSugerida";
import { fotoDaPessoa, apagarFoto } from "../src/services/gestao/fichaConfig";

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, 1)]);
const pessoa = Number(db.prepare("INSERT INTO gestao_pessoas(tipo,nome) VALUES ('cliente','Zz Foto Sugerida')").run().lastInsertRowid);
afterAll(() => { descartarSugestao(pessoa); apagarFoto(pessoa); db.prepare("DELETE FROM gestao_pessoas WHERE id=?").run(pessoa); });

describe("foto sugerida a partir do RG/CNH", () => {
  it("caixa: aceita retrato plausível (com folga) e recusa o absurdo", () => {
    const c = caixaValida({ x: 0.1, y: 0.2, largura: 0.2, altura: 0.3 })!;
    expect(c.x).toBeLessThan(0.1); expect(c.largura).toBeGreaterThan(0.2);
    expect(caixaValida(null)).toBeNull();
    expect(caixaValida({ x: 0.5, y: 0.5, largura: 0.9, altura: 0.9 })).toBeNull();
    expect(caixaValida({ x: 0, y: 0, largura: 0.95, altura: 0.95 })).toBeNull();
    expect(caixaValida({ x: 0, y: 0, largura: 0.01, altura: 0.5 })).toBeNull();
    expect(caixaValida({ x: Number.NaN, y: 0, largura: 0.2, altura: 0.2 })).toBeNull();
  });

  it("não sugere para o que não é documento com foto, nem sem cadastro, nem quando não é imagem", async () => {
    const nao = async () => ({ eh_documento_com_foto: false, tipo_documento: "nenhum", caixa: null });
    expect(await sugerirFotoDoDocumento(pessoa, PNG, "Comprovante", nao)).toBe("sem_retrato");
    expect(await sugerirFotoDoDocumento(null, PNG, "RG", nao)).toBe("sem_cadastro");
    expect(await sugerirFotoDoDocumento(pessoa, Buffer.from("%PDF-1.4"), "RG", nao)).toBe("nao_e_imagem");
    expect(fotoSugeridaDaPessoa(pessoa)).toBeNull();
  });

  it("sugere, não duplica, e só vira foto do cadastro quando alguém aceita (a cópia do documento é apagada)", async () => {
    const sim = async () => ({ eh_documento_com_foto: true, tipo_documento: "RG", caixa: { x: 0.1, y: 0.2, largura: 0.2, altura: 0.3 } });
    expect(await sugerirFotoDoDocumento(pessoa, PNG, "RG frente", sim)).toBe("sugerida");
    expect(fotoDaPessoa(pessoa)).toBeNull(); // ainda não é a foto
    expect(await sugerirFotoDoDocumento(pessoa, PNG, "RG verso", sim)).toBe("ja_sugerida");
    expect(fotoSugeridaDaPessoa(pessoa)?.documento).toBe("RG");
    aceitarSugestao(pessoa, PNG);
    expect(fotoDaPessoa(pessoa)).not.toBeNull();
    expect(fotoSugeridaDaPessoa(pessoa)).toBeNull();
    expect(await sugerirFotoDoDocumento(pessoa, PNG, "CNH", sim)).toBe("ja_tem_foto"); // quem já tem foto não gasta IA
  });
});
