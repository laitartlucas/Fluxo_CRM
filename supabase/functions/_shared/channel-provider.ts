// ChannelProvider — abstração comum sobre os dois gateways de mensageria
// decididos no adendo (ver comentário de supabase/migrations/0031_channels.sql):
// Evolution API (WhatsApp, self-hosted, não-oficial) e Instagram Graph API
// (Meta, oficial). O resto do sistema (webhooks, ai-agent-respond,
// send-conversation-message, send-campaign-batch) só fala com esta
// interface — nunca decide "qual provider" fora daqui.
//
// Credenciais: channels.credential_ref NUNCA guarda o token em si (ver
// comentário da migration 0031) — guarda o NOME de uma env var do projeto
// de Edge Functions que contém o segredo real. Para WhatsApp, essa env var
// contém um JSON `{ "baseUrl": "...", "apiKey": "...", "instanceName": "..." }`
// (uma instância Evolution API por canal). Para Instagram, contém o
// access token de página (Page Access Token) como string simples.
//
// IMPORTANTE — payloads não testados ao vivo: os formatos exatos de
// request/response do Evolution API (varia por versão/fork da instância
// self-hosted) e da Instagram Graph API (a Meta muda esse fluxo com
// frequência, como o próprio adendo já avisa) foram implementados a partir
// da documentação pública mais comum, mas SÓ podem ser validados de
// verdade contra uma instância/app real — o que ainda não temos disponível
// neste projeto. Antes de operar em produção, validar com um envio real.

export interface ChannelRow {
  id: string;
  owner_id: string;
  type: "whatsapp" | "instagram";
  provider: "evolution_api" | "instagram_graph_api";
  phone_number: string | null;
  external_account_id: string | null;
  credential_ref: string | null;
}

export interface SendMessageParams {
  channel: ChannelRow;
  /** Número de telefone (WhatsApp, formato E.164 sem "+") ou IGSID (Instagram). */
  to: string;
  contentType: "text" | "image" | "audio" | "video" | "document";
  /** Texto, ou URL da mídia para tipos não-texto. */
  content: string;
}

export interface SendMessageResult {
  externalMessageId: string;
}

export interface ConnectionStatusResult {
  status: "connected" | "disconnected" | "error" | "pending_qr";
  qualityRating?: "green" | "yellow" | "red";
}

export interface ChannelProvider {
  sendMessage(params: SendMessageParams): Promise<SendMessageResult>;
  getConnectionStatus(channel: ChannelRow): Promise<ConnectionStatusResult>;
}

export class ChannelProviderError extends Error {
  constructor(message: string, public readonly providerResponse?: unknown) {
    super(message);
    this.name = "ChannelProviderError";
  }
}

function resolveCredential(credentialRef: string | null): string {
  if (!credentialRef) {
    throw new ChannelProviderError("channel has no credential_ref configured");
  }
  const value = Deno.env.get(credentialRef);
  if (!value) {
    throw new ChannelProviderError(`secret "${credentialRef}" is not set for this Edge Functions project`);
  }
  return value;
}

interface EvolutionCredential {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}

function parseEvolutionCredential(raw: string): EvolutionCredential {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.baseUrl || !parsed.apiKey || !parsed.instanceName) {
      throw new Error("missing baseUrl/apiKey/instanceName");
    }
    return parsed;
  } catch (err) {
    throw new ChannelProviderError(`invalid Evolution API credential JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============ WhatsApp via Evolution API ============
export class EvolutionApiProvider implements ChannelProvider {
  async sendMessage({ channel, to, contentType, content }: SendMessageParams): Promise<SendMessageResult> {
    const cred = parseEvolutionCredential(resolveCredential(channel.credential_ref));
    const endpoint = contentType === "text" ? "sendText" : "sendMedia";
    const body = contentType === "text"
      ? { number: to, text: content }
      : { number: to, mediatype: contentType, media: content };

    const res = await fetch(`${cred.baseUrl}/message/${endpoint}/${cred.instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cred.apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ChannelProviderError(`Evolution API sendMessage failed: ${res.status}`, text);
    }
    const data = await res.json();
    const externalMessageId = data?.key?.id ?? data?.id ?? crypto.randomUUID();
    return { externalMessageId };
  }

  async getConnectionStatus(channel: ChannelRow): Promise<ConnectionStatusResult> {
    const cred = parseEvolutionCredential(resolveCredential(channel.credential_ref));
    const res = await fetch(`${cred.baseUrl}/instance/connectionState/${cred.instanceName}`, {
      headers: { apikey: cred.apiKey },
    });
    if (!res.ok) {
      return { status: "error" };
    }
    const data = await res.json();
    const state = data?.instance?.state ?? data?.state;
    if (state === "open") return { status: "connected" };
    if (state === "connecting" || state === "qrcode") return { status: "pending_qr" };
    return { status: "disconnected" };
  }
}

// ============ Instagram via Meta Graph API ============
export class InstagramGraphProvider implements ChannelProvider {
  async sendMessage({ channel, to, contentType, content }: SendMessageParams): Promise<SendMessageResult> {
    const accessToken = resolveCredential(channel.credential_ref);
    const message = contentType === "text"
      ? { text: content }
      : { attachment: { type: contentType === "document" ? "file" : contentType, payload: { url: content } } };

    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: to }, message }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ChannelProviderError(`Instagram Graph API sendMessage failed: ${res.status}`, text);
    }
    const data = await res.json();
    const externalMessageId = data?.message_id ?? crypto.randomUUID();
    return { externalMessageId };
  }

  async getConnectionStatus(channel: ChannelRow): Promise<ConnectionStatusResult> {
    const accessToken = resolveCredential(channel.credential_ref);
    const res = await fetch(`https://graph.facebook.com/v21.0/me?fields=id&access_token=${encodeURIComponent(accessToken)}`);
    return res.ok ? { status: "connected" } : { status: "error" };
  }
}

export function getChannelProvider(channel: ChannelRow): ChannelProvider {
  switch (channel.provider) {
    case "evolution_api":
      return new EvolutionApiProvider();
    case "instagram_graph_api":
      return new InstagramGraphProvider();
    default:
      throw new ChannelProviderError(`unknown provider "${channel.provider}"`);
  }
}
