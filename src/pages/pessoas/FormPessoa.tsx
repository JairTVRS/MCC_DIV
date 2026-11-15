import { useState, type FormEvent } from 'react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { Pessoa, TipoPessoa } from '../../lib/tipos';
import { ehLocador, ehLocatario, mascaraTelefone } from '../agenda/formatos';

const COLUNAS = 'id, nome, tipo, telefone, email, documento';

interface Props {
  pessoa?: Pessoa | null; // sem pessoa = cadastro novo
  nomeInicial?: string;
  tipoInicial?: 'locatario' | 'locador';
  onFechar: () => void;
  onSalvo: (p: Pessoa) => void;
  onExcluido?: () => void;
}

/** Cadastro de pessoa (locatário, locador ou os dois). Abre da tela Pessoas e de dentro da reserva. */
export function FormPessoa({ pessoa, nomeInicial, tipoInicial, onFechar, onSalvo, onExcluido }: Props) {
  const { tem } = useSessao();
  const nova = !pessoa;
  const editavel = nova ? tem('pessoas.incluir') : tem('pessoas.alterar');
  const [nome, setNome] = useState(pessoa?.nome ?? nomeInicial ?? '');
  const [locatario, setLocatario] = useState(pessoa ? ehLocatario(pessoa.tipo) : tipoInicial !== 'locador');
  const [locador, setLocador] = useState(pessoa ? ehLocador(pessoa.tipo) : tipoInicial === 'locador');
  const [telefone, setTelefone] = useState(pessoa?.telefone ?? '');
  const [email, setEmail] = useState(pessoa?.email ?? '');
  const [documento, setDocumento] = useState(pessoa?.documento ?? '');
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const tipo: TipoPessoa | null = locatario && locador ? 'ambos' : locatario ? 'locatario' : locador ? 'locador' : null;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return setErro('Informe o nome.');
    if (!tipo) return setErro('Marque se a pessoa é locatário, locador ou os dois.');
    setOcupado(true);
    setErro(null);
    const dados = { nome: nome.trim(), tipo, telefone: telefone.trim() || null, email: email.trim() || null, documento: documento.trim() || null };
    const r = nova
      ? await supabase.from('pessoas').insert(dados).select(COLUNAS).single()
      : await supabase.from('pessoas').update(dados).eq('id', pessoa.id).select(COLUNAS).single();
    setOcupado(false);
    if (r.error) return setErro(mensagemErro(r.error));
    onSalvo(r.data as Pessoa);
  }

  async function excluir() {
    if (!pessoa) return;
    setOcupado(true);
    setErro(null);
    const { error } = await supabase.rpc('excluir_registro', { p_tabela: 'pessoas', p_id: pessoa.id });
    setOcupado(false);
    if (error) {
      setConfirmarExclusao(false);
      return setErro(mensagemErro(error));
    }
    onExcluido?.();
  }

  return (
    <>
      <div className="scrim alto" onClick={ocupado ? undefined : onFechar} />
      <form className="modal estreito alto" role="dialog" aria-modal="true" aria-label={nova ? 'Nova pessoa' : 'Pessoa'} onSubmit={salvar}>
        <div className="m-head">
          <h2>{nova ? 'Nova pessoa' : 'Pessoa'}</h2>
          <button type="button" className="ib" onClick={onFechar} aria-label="Fechar" disabled={ocupado}>
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          <label className="campo">
            <span className="rot">Nome *</span>
            <input className="inp" value={nome} maxLength={120} autoFocus disabled={!editavel || ocupado} onChange={(e) => setNome(e.target.value)} />
          </label>
          <div className="campo">
            <span className="rot">Tipo *</span>
            <div className="caixas">
              <label className="chave">
                <input type="checkbox" checked={locatario} disabled={!editavel || ocupado} onChange={(e) => setLocatario(e.target.checked)} />
                <span>Locatário</span>
              </label>
              <label className="chave">
                <input type="checkbox" checked={locador} disabled={!editavel || ocupado} onChange={(e) => setLocador(e.target.checked)} />
                <span>Locador</span>
              </label>
            </div>
          </div>
          <div className="duas-colunas">
            <label className="campo">
              <span className="rot">Telefone</span>
              <input className="inp" value={telefone} inputMode="tel" placeholder="(37) 99999-9999" disabled={!editavel || ocupado} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} />
            </label>
            <label className="campo">
              <span className="rot">Documento</span>
              <input className="inp" value={documento} maxLength={40} placeholder="CPF, CNPJ ou outro" disabled={!editavel || ocupado} onChange={(e) => setDocumento(e.target.value)} />
            </label>
          </div>
          <label className="campo">
            <span className="rot">E-mail</span>
            <input className="inp" type="email" value={email} maxLength={120} disabled={!editavel || ocupado} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {!editavel && <p className="note">Só leitura: seu grupo não pode {nova ? 'incluir' : 'alterar'} pessoas.</p>}
          {erro && (
            <p className="msg-erro" role="alert">
              {erro}
            </p>
          )}
        </div>
        <div className="m-foot">
          {!nova && tem('pessoas.excluir') &&
            (confirmarExclusao ? (
              <>
                <button type="button" className="btn" onClick={() => setConfirmarExclusao(false)} disabled={ocupado}>
                  Voltar
                </button>
                <button type="button" className="btn perigo" onClick={() => void excluir()} disabled={ocupado}>
                  Confirmar exclusão
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirmarExclusao(true)} disabled={ocupado} title="Vai para a lixeira">
                <Icone nome="trash" tamanho={16} />
                Excluir
              </button>
            ))}
          <span className="sp" />
          <button type="button" className="btn" onClick={onFechar} disabled={ocupado}>
            {editavel ? 'Cancelar' : 'Fechar'}
          </button>
          {editavel && (
            <button type="submit" className="btn pri" disabled={ocupado || !nome.trim() || !tipo}>
              {ocupado ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </div>
      </form>
    </>
  );
}
