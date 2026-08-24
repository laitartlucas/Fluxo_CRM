import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type { TenantSettings } from '../lib/types'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner, ErrorBanner } from '../components/ui/Feedback'

export function AjustesPage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  const settingsKey = ['tenant-settings', profile?.id]
  const { data: settings, isLoading, error } = useQuery({
    queryKey: settingsKey,
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.from('tenant_settings').select('*').eq('owner_id', profile!.id).maybeSingle()
      if (error) throw error
      return data as TenantSettings | null
    },
  })

  const [brandName, setBrandName] = useState('')
  const [brandLogoUrl, setBrandLogoUrl] = useState('')
  const [brandColor, setBrandColor] = useState('#6366f1')
  const [businessHoursText, setBusinessHoursText] = useState('{"seg-sex": "08:00-18:00"}')
  const [costPerMessage, setCostPerMessage] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (settings) {
      setBrandName(settings.brand_name ?? '')
      setBrandLogoUrl(settings.brand_logo_url ?? '')
      setBrandColor(settings.brand_primary_color ?? '#6366f1')
      setBusinessHoursText(JSON.stringify(settings.default_business_hours ?? { 'seg-sex': '08:00-18:00' }, null, 2))
      setCostPerMessage(settings.cost_per_message != null ? String(settings.cost_per_message) : '')
    }
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: async () => {
      let defaultBusinessHours: Record<string, string> | null
      try {
        defaultBusinessHours = businessHoursText.trim() ? JSON.parse(businessHoursText) : null
      } catch {
        throw new Error('Horário comercial precisa ser JSON válido')
      }
      const { error } = await supabase.from('tenant_settings').upsert({
        owner_id: profile!.id,
        brand_name: brandName || null,
        brand_logo_url: brandLogoUrl || null,
        brand_primary_color: brandColor || null,
        default_business_hours: defaultBusinessHours,
        cost_per_message: costPerMessage.trim() ? Number(costPerMessage) : null,
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKey }),
    onError: (err) => setSaveError((err as Error).message),
  })

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Ajustes</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">Branding e configurações gerais da conta</p>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBanner message={(error as Error).message} />}

      <Card>
        <CardHeader>Branding</CardHeader>
        <CardBody className="space-y-3">
          <p className="text-[11.5px] text-ink-muted">
            Nome, logo e cor usados como identidade visual do produto para este tenant — útil se este mesmo sistema
            for revendido white-label para outros clientes.
          </p>
          {saveError && <ErrorBanner message={saveError} />}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Nome do produto</label>
            <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Fluxo" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">URL do logo</label>
            <Input value={brandLogoUrl} onChange={(e) => setBrandLogoUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Cor primária</label>
            <div className="flex items-center gap-2">
              <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-9 w-14 rounded-[8px] border border-border" />
              <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-32" />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Horário comercial padrão</CardHeader>
        <CardBody className="space-y-2">
          <p className="text-[11.5px] text-ink-muted">
            Usado como padrão sugerido ao criar uma nova configuração do Atendente IA — cada configuração pode
            sobrescrever o próprio horário.
          </p>
          <textarea
            value={businessHoursText}
            onChange={(e) => setBusinessHoursText(e.target.value)}
            rows={4}
            className="w-full rounded-[10px] border border-border bg-surface-alt px-3 py-2 font-mono text-[12px] outline-none focus:border-accent focus:bg-surface"
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Custos</CardHeader>
        <CardBody className="space-y-2">
          <p className="text-[11.5px] text-ink-muted">
            Custo estimado por mensagem enviada (não vem de nenhum provedor automaticamente — depende do seu plano
            contratado). Usado para calcular o "custo por conversa" no Painel; deixe em branco para ocultar essa métrica.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Custo por mensagem (R$)</label>
            <Input
              type="number"
              step="0.0001"
              min="0"
              value={costPerMessage}
              onChange={(e) => setCostPerMessage(e.target.value)}
              placeholder="ex: 0.05"
              className="w-40"
            />
          </div>
        </CardBody>
      </Card>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        {saveMutation.isPending ? 'Salvando…' : 'Salvar ajustes'}
      </Button>
    </div>
  )
}
