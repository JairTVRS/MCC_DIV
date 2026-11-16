import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSessao } from '../../auth/Sessao';
import { COLUNAS_PESSOA, carregarMovimentosParoquias } from '../../lib/cadastros';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { ItemCadastro, Pessoa, TipoPessoa } from '../../lib/tipos';
import { ehLocador, ehLocatario, mascaraTelefone } from '../agenda/formatos';
import { JanelaHistorico } from '../historico/JanelaHistorico';
import { SeletorCadastro } from './SeletorCadastro';

interface Props {
  pessoa?: Pessoa | null; // sem pessoa = cadastro novo
  nomeInicial?: string;
  tipoInicial?: 'locatario' | 'locador';
  onFechar: () => void;
  onSalvo: (p: Pessoa) => void;
}

const porOrdem = (a: ItemCadastro, b: ItemCadastro) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR');

/**
 * Cadastro de pessoa (locatário, locador ou os dois). Abre da tela Pessoas e de dentro da reserva.
 * Movimento e paróquia são obrigatórios (v1.1.0); pessoa antiga sem eles precisa preencher ao salvar.
 * Pessoa não é excluída: é inativada (Pessoas > Inativar e reativar), e o histórico continua.
 */
export function FormPessoa({ pessoa, nomeInicial, tipoInicial, onFechar, onSalvo }: Props) {
  const { tem } = useSessao();
  const nova = !pessoa;
  const editavel = nova ? tem('pessoas.incluir') : tem('pessoas.alterar');
  const [nome, setNome] = useState(pessoa?.nome ?? nomeInicial ?? '');
  const [locatario, setLocatario] = useState(pessoa ? ehLocatario(pessoa.tipo) : tipoInicial !== 'locador');
  const [locador, setLocador] = useState(pessoa ? ehLocador(pessoa.tipo) : tipoInicial === 'locador');
  const [movimento, setMovimento] = useState(pessoa?.movimento_id ?? '');
  const [paroquia, setParoquia] = useState(pessoa?.paroquia_id ?? '');
  const [telefone, setTelefone] = useState(pessoa?.telefone ?? '');
  const [email, setEmail] = useState(pessoa?.email ?? '');
  const [documento, setDocumento] = useState(pessoa?.documento ?? '');
  const [movimentos, setMovimentos] = useState<ItemCadastro[]>([]);
  const [paroquias, setParoquias] = useState<ItemCadastro[]>([]);
  const [confirmarInativar, setConfirmarInativar] = useState(false);
  const [historico, setHistorico] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const alvo = useMemo(() => (pessoa ? { tipo: 'pessoa' as const, id: pessoa.id } : null), [pessoa]);

  useEffect(() => {
    carregarMovimentosParoquias()
      .then((c) => {
        setMovimentos(c.movimentos);
        setParoquias(c.paroquias);
      })
      .catch((e) => setErro(mensagemErro(e)));
  }, []);

  const tipo: TipoPessoa | null = locatario && locador ? 'ambos' : locatario ? 'locatario' : locador ? 'locador' : null;
  const inativa = pessoa?.ativo === false;
  const semCadastros = !!pessoa && (!pessoa.movimento_id || !pessoa.paroquia_id);
  const completo = !!nome.trim() && !!tipo && !!movimento && !!paroquia;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return setErro('Informe o nome.');
    if (!tipo) return setErro('Marque se a pessoa é locatário, locador ou os dois.');
    if (!movimento) return setErro('Escolha o movimento.');
    if (!paroquia) return setErro('Escolha a paróquia.');
    setOcupado(true);
    setErro(null);
    const dados = {
      nome: nome.trim(),
      tipo,
      movimento_id: movimento,
      paroquia_id: paroquia,
      telefone: telefone.trim() || null,
      email: email.trim() || null,
      documento: documento.trim() || null,
    };
    const r = nova
      ? await supabase.from('pessoas').insert(dados).select(COLUNAS_PESSOA).single()
      : await supabase.from('pessoas').update(dados).eq('id', pessoa.id).select(COLUNAS_PESSOA).single();
    setOcupado(false);
    if (r.error) return setErro(mensagemErro(r.error));
    onSalvo(r.data as Pessoa);
  }

  async function mudarAtivo(ativo: boolean) {
    if (!pessoa) return;
    setOcupado(true);
    setErro(null);
    const { data, error } = await supabase.from('pessoas').update({ ativo }).eq('id', pessoa.id).select(COLUNAS_PESSOA).single();
    setOcupado(false);
    setConfirmarInativar(false);
    if (error) return setErro(mensagemErro(error));
    onSalvo(data as Pessoa);
  }

  return (
    <>
      <div className="scrim alto" onClick={ocupado ? undefined : onFechar} />
      <form className="modal estreito alto" role="dialog" aria-modal="true" aria-label={nova ? 'Nova pessoa' : 'Pessoa'} onSubmit={salvar}>
        <div className="m-head">
          <h2>{nova ? 'Nova pessoa' : 'Pessoa'}</h2>
          {inativa && <span className="tag">Inativa</span>}
          {alvo && tem('logs.pessoa') && (
            <button type="button" className="ib" onClick={() => setHistorico(true)} aria-label="Histórico da pessoa" title="Histórico da pessoa">
              <Icone nome="relogio" />
            </button>
          )}
          <button type="button" className="ib" onClick={onFechar} aria-label="Fechar" disabled={ocupado}>
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          {inativa && <p className="aviso">Pessoa inativa: não aparece para reservas novas. As reservas e o histórico dela continuam.</p>}
          {semCadastros && editavel && !inativa && <p className="aviso">Cadastro anterior ao movimento e à paróquia: escolha os dois para salvar.</p>}
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
            <SeletorCadastro
              qual="movimentos"
              itens={movimentos}
              valor={movimento}
              podeIncluir={editavel && tem('configuracoes.movimentos')}
              desabilitado={!editavel || ocupado}
              onMudar={setMovimento}
              onIncluido={(m) => {
                setMovimentos((l) => [...l, m].sort(porOrdem));
                setMovimento(m.id);
              }}
            />
            <SeletorCadastro
              qual="paroquias"
              itens={paroquias}
              valor={paroquia}
              podeIncluir={editavel && tem('configuracoes.paroquias')}
              desabilitado={!editavel || ocupado}
              onMudar={setParoquia}
              onIncluido={(p) => {
                setParoquias((l) => [...l, p].sort(porOrdem));
                setParoquia(p.id);
              }}
            />
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
          {!nova &&
            tem('pessoas.inativar') &&
            (inativa ? (
              <button type="button" className="btn" onClick={() => void mudarAtivo(true)} disabled={ocupado}>
                <Icone nome="restore" tamanho={16} />
                Reativar
              </button>
            ) : confirmarInativar ? (
              <>
                <button type="button" className="btn" onClick={() => setConfirmarInativar(false)} disabled={ocupado}>
                  Voltar
                </button>
                <button type="button" className="btn perigo" onClick={() => void mudarAtivo(false)} disabled={ocupado}>
                  Confirmar inativação
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirmarInativar(true)} disabled={ocupado} title="Some das reservas novas; o histórico continua">
                <Icone nome="out" tamanho={16} />
                Inativar
              </button>
            ))}
          <span className="sp" />
          {/* Na confirmação da inativação, só Voltar e Confirmar (o rodapé não quebra linha). */}
          {!confirmarInativar && (
            <>
              <button type="button" className="btn" onClick={onFechar} disabled={ocupado}>
                {editavel ? 'Cancelar' : 'Fechar'}
              </button>
              {editavel && (
                <button type="submit" className="btn pri" disabled={ocupado || !completo}>
                  {ocupado ? 'Salvando…' : 'Salvar'}
                </button>
              )}
            </>
          )}
        </div>
      </form>
      {historico && alvo && <JanelaHistorico alvo={alvo} nome={pessoa?.nome} onFechar={() => setHistorico(false)} />}
    </>
  );
}
