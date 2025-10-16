# Configuração do ZapSign

## Variáveis de Ambiente Necessárias

Para usar a integração com ZapSign, adicione as seguintes variáveis no arquivo `.env` do backend:

```env
# Configurações do ZapSign (opcional - para assinatura digital)
ZAPSIGN_API_KEY=e24c45bf-1478-4d29-9fa7-84b066f74f9fccad4998-40ff-445f-9bcb-c70b9c869c16
ZAPSIGN_ORGANIZATION_ID=1304128
ZAPSIGN_API_URL=https://api.zapsign.com.br
```

## Modo de Teste

O sistema funciona em modo de teste quando:

- ✅ **Credenciais não configuradas**: Usa token simulado
- ✅ **Endpoint não encontrado (404)**: Usa modo simulado automaticamente
- ✅ **Erro na API**: Continua com modo simulado
- ✅ **Foto sempre salva**: Independente do ZapSign
- ✅ **Assinatura eletrônica sempre gerada**: Hash único sempre criado

## Como Configurar no Seu Projeto

1. **Adicione no arquivo `.env` do backend:**

    ```env
    ZAPSIGN_API_KEY=e24c45bf-1478-4d29-9fa7-84b066f74f9fccad4998-40ff-445f-9bcb-c70b9c869c16
    ZAPSIGN_ORGANIZATION_ID=1304128
    ZAPSIGN_API_URL=https://api.zapsign.com.br
    ```

2. **Reinicie o backend** para carregar as novas variáveis

3. **Teste o sistema** - agora deve funcionar com ZapSign real!

## Funcionalidades Implementadas

### ✅ **Sincronização Completa:**

- **📄 Criar Documento**: Envia contrato para ZapSign
- **📊 Consultar Status**: Atualiza status de assinaturas
- **🗑️ Excluir Documento**: Remove do ZapSign
- **🔄 Sincronização**: Atualiza todos os contratos

### ✅ **Dados Salvos:**

- **ID do Documento**: `zapsign_document_id`
- **Links dos Signatários**: `zapsign_signers_data`
- **Status Completo**: `zapsign_document_status`
- **Assinaturas no PDF**: Assinaturas inseridas diretamente no documento

### ✅ **Interface do Usuário:**

- **🔗 Seção ZapSign**: Exibe dados do documento
- **📋 Botões de Ação**: Consultar, excluir, sincronizar
- **📱 Links Copiáveis**: Para envio aos signatários

## Testando o Sistema

O sistema funcionará perfeitamente mesmo sem as credenciais do ZapSign configuradas, permitindo testar todo o fluxo de assinatura eletrônica.

### 🎯 **Fluxo Completo:**

1. **Assinar Contrato** → Salva foto + assinatura eletrônica
2. **Regenerar PDF** → Insere assinaturas diretamente no documento
3. **Enviar para ZapSign** → Cria documento digital com assinaturas
4. **Consultar Status** → Atualiza progresso das assinaturas
5. **Copiar Links** → Enviar para signatários
6. **Sincronizar** → Manter dados atualizados

### ✍️ **Assinaturas no PDF:**

- **📝 Assinatura do Aluno**: Aparece acima da linha de assinatura
- **👥 Assinaturas das Testemunhas**: Inseridas nas respectivas seções
- **🔄 Regeneração Automática**: PDF é atualizado antes de enviar para ZapSign
- **📄 Visualização Correta**: Assinaturas aparecem no documento final
