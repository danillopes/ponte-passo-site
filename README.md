# Ponte Pênsil do Rio Mampituba — modelo 3D + estudo luminotécnico

Modelo 3D paramétrico da ponte pênsil que liga **Torres (RS)** a **Passo de Torres (SC)**, reconstruída em 2024, com um simulador de iluminação LED em unidades físicas.

**Abrir:** `index.html` (modelo interativo) · `guia.html` (memorial técnico) · `blender/ponte_pensil_blender.py` (gerador para Blender 3.6/4.x)

## O que tem
- Ponte completa: torres-pórtico, 4 cabos em parábola (flecha 7,05 m), 98 pendurais a cada 2 m, transversinas, longarinas, 617 pranchas, guarda-corpo de 1,20 m com tela, patamares, escadas e ancoragens.
- Cenário: rio com reflexo e ondulação, cais, praças, cidade de Torres (edifícios) e Passo de Torres (casas), barcos, pessoas em escala, iluminação pública existente e a ponte de concreto ao fundo (posição aproximada).
- 12 grupos de luminárias (cabos, corrimão, pendurais, torres, pórtico, sob o tabuleiro, cais, rodapé, luz longitudinal para reconhecimento, escadas, avulsas posicionadas por clique e projetores 10 W) com 9 modelos de LED.
- Para cada grupo: cor (CCT 1800–6500 K ou RGB), potência, dimerização, eficácia, facho e **luminância em nits** (a potência é recalculada a partir dos nits).
- Camadas **funcional** (avaliada) e **cênica** (cor, efeitos), ligáveis em separado.
- Curvas fotométricas reais: cada grupo aceita arquivo **IES (LM-63) ou EULUMDAT (.ldt)**; a prévia projeta a distribuição C/γ e aplica os fatores de `TILT=INCLUDE`.
- Luzes em candela e emissores em cd/m²; cálculo ponto a ponto da iluminância horizontal no piso e vertical a 1,50 m, com obstrução da tela/rodapé, fator de manutenção e valores mantidos.
- Critérios por classe **editáveis**: vêm com referência provisória (EN 13201-2) e devem ser conferidos na ABNT NBR 5101:2024. O resultado é sempre apresentado como estimativa.
- Materiais com mapas de cor, relevo e rugosidade (atlas de 12 pranchas, concreto com sujeira por altura, aço galvanizado), balanço de branco por período e reflexo de água suavizado.
- Revisão visual realista: concreto e metais menos plásticos, madeira com relevo controlado, skyline com coroamentos/recuos, água com ondas direcionais e reflexos verticais, além de pós-processamento que preserva a cor dos LEDs sem estourar os pontos de luz.
- Desempenho: entorno sem cálculo de spots, piso com mapa de luz do próprio cálculo, orçamento de luzes por qualidade, LOD por distância, resolução dinâmica e renderização sob demanda (o `requestAnimationFrame` é suspenso quando a cena fica parada).
- Efeitos DMX (respiração, onda, corrida, arco-íris), períodos (noite, hora azul, dia), cotas sobre o modelo.
- Exporta GLB (Blender/Rhino/3ds Max, com luzes spot), CSV de quantitativo, projeto em JSON e imagem PNG.
- **Tour gravado em vídeo:** na aba Arquivo, o modo “Gravar tour 360°” percorre a ponte, enquadra todos os grupos de luz ativos e grava as especificações no próprio vídeo. Há saída vertical Full HD (1080 × 1920) para celular e paisagem Full HD (1920 × 1080). O navegador gera MP4/H.264 quando disponível e usa WebM como alternativa.

## Gravar um tour 360°
1. Abra a página no Chrome ou Edge atualizado em um computador.
2. Escolha a cena, ligue os grupos de iluminação que devem aparecer e abra **Arquivo**.
3. Escolha **Celular vertical** ou **Paisagem** e clique em **Gravar tour 360°**.
4. Mantenha a aba aberta. É possível parar e baixar antes do fim ou cancelar sem salvar.

O tour completo dura aproximadamente 45–60 segundos, dependendo do número de grupos ativos. A interface é restaurada automaticamente após o download.

## Entorno real e iluminação (v5)

- **Entorno do OpenStreetMap** (© colaboradores do OpenStreetMap, ODbL): margens e quadras reais, 898 edificações com telhado cerâmico ou laje, vias de asfalto/lajota com calçadas, 104 letreiros de comércios reais, postes com poças de luz, guarda-corpo azul da margem, trapiche, barcos e a ponte rodoviária na posição real. Dados em `data/` (carregados em tempo de execução; se falharem, volta o entorno genérico).
- **Árvores procedurais** (jerivás com folhas recortadas, árvores de copa larga e arbustos) em ruas, margens, praças e quintais.
- **Letreiro #EUPASSODETORRES** ao lado do pé da escada de SC.
- **Projetor LED 10 W foco fechado**: corpo aletado, lente em domo e suporte em U; perfil angular real (núcleo + halo + espalhamento) no cálculo e no shader; **facho visível no ar** com espalhamento físico (controle "Facho visível no ar" na aba Cena).
- **Editor de luminárias**: crie grupos avulsos, clique para fixar na superfície (chão, fachada, ponte, árvore), clique para mirar, selecione clicando na luminária, mova com setas, ajuste giro/inclinação, duplique e exclua. "Editar individualmente" separa qualquer grupo em luminárias avulsas.
- Navegação mais precisa (sensibilidade ajustável) e câmera impedida de descer abaixo do chão.

## Vídeo, LEDs atuais e desempenho (v6)

- **Vídeo do tour** (aba Arquivo): renderizado quadro a quadro com WebCodecs e montado em MP4 (H.264) com [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT, em `vendor/mp4-muxer`). Sai a 60 ou 30 qps em 1080p sem engasgos, mesmo em PC lento — só demora mais para gerar. A câmera visita cada grupo de luz ligado, com destaque no ponto iluminado.
- **Cena "Situação atual"** refeita pelas fotos: mangueira azul sobre os cabos e **sobre o corrimão** (nova opção "Posição da fita"), torres lavadas de azul e pontos brancos baixos no tabuleiro.
- Removida a montagem "sob o tabuleiro" (não será implementada); projetos salvos com ela são carregados sem esse grupo.
- Letreiro #EUPASSODETORRES ao lado da ponte, sobre canteiro de grama, de frente para a praça (SC).
- Desempenho: número fixo de luzes no shader (ligar/desligar grupos não recompila mais os materiais), resolução reduzida só enquanto a câmera é arrastada, cálculo de lux em etapas.

## Rodar localmente
Qualquer servidor estático serve (o three.js está em `vendor/`, sem build):
```
python -m http.server 8000
```
e abra http://localhost:8000.

## Premissas
Vão, largura e materiais vêm de fontes publicadas; cotas, flecha e seções foram estimadas a partir de fotografias e pré-dimensionamento. A lista do que é publicado, estimado e precisa de levantamento está em `guia.html#levantamento`. Não substitui projeto estrutural ou luminotécnico executivo.

Feito com [three.js](https://threejs.org) r165 (MIT).
