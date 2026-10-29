# Ponte Pênsil do Rio Mampituba — modelo 3D + estudo luminotécnico

Modelo 3D paramétrico da ponte pênsil que liga **Torres (RS)** a **Passo de Torres (SC)**, reconstruída em 2024, com um simulador de iluminação LED em unidades físicas.

**Abrir:** `index.html` (modelo interativo) · `guia.html` (memorial técnico) · `blender/ponte_pensil_blender.py` (gerador para Blender 3.6/4.x)

## O que tem
- Ponte completa: torres-pórtico, 4 cabos em parábola (flecha 7,05 m), 98 pendurais a cada 2 m, transversinas, longarinas, 617 pranchas, guarda-corpo de 1,20 m com tela, patamares, escadas e ancoragens.
- Cenário: rio com reflexo e ondulação, cais, praças, cidade de Torres (edifícios) e Passo de Torres (casas), barcos, pessoas em escala, iluminação pública existente e a ponte de concreto ao fundo (posição aproximada).
- 10 grupos de luminárias (cabos, corrimão, pendurais, torres, pórtico, sob o tabuleiro, cais, rodapé, escadas e avulsas posicionadas por clique) com 8 modelos de LED.
- Para cada grupo: cor (CCT 1800–6500 K ou RGB), potência, dimerização, eficácia, facho e **luminância em nits** (a potência é recalculada a partir dos nits).
- Camadas **funcional** (avaliada) e **cênica** (cor, efeitos), ligáveis em separado.
- Curvas fotométricas reais: cada grupo aceita arquivo **IES (LM-63) ou EULUMDAT (.ldt)**.
- Luzes em candela e emissores em cd/m²; cálculo ponto a ponto da iluminância horizontal no piso e vertical a 1,50 m, com obstrução da tela/rodapé, fator de manutenção e valores mantidos.
- Critérios por classe **editáveis**: vêm com referência provisória (EN 13201-2) e devem ser conferidos na ABNT NBR 5101:2024. O resultado é sempre apresentado como estimativa.
- Materiais com mapas de cor, relevo e rugosidade (atlas de 12 pranchas, concreto com sujeira por altura, aço galvanizado), balanço de branco por período e reflexo de água suavizado.
- Desempenho: entorno sem cálculo de spots, piso com mapa de luz do próprio cálculo, orçamento de luzes por qualidade, LOD por distância, resolução dinâmica e renderização sob demanda (para de desenhar com a cena parada).
- Efeitos DMX (respiração, onda, corrida, arco-íris), períodos (noite, hora azul, dia), cotas sobre o modelo.
- Exporta GLB (Blender/Rhino/3ds Max, com luzes spot), CSV de quantitativo, projeto em JSON e imagem PNG.

## Entorno real e iluminação (v5)

- **Entorno do OpenStreetMap** (© colaboradores do OpenStreetMap, ODbL): margens e quadras reais, 898 edificações com telhado cerâmico ou laje, vias de asfalto/lajota com calçadas, 104 letreiros de comércios reais, postes com poças de luz, guarda-corpo azul da margem, trapiche, barcos e a ponte rodoviária na posição real. Dados em `data/` (carregados em tempo de execução; se falharem, volta o entorno genérico).
- **Árvores procedurais** (jerivás com folhas recortadas, árvores de copa larga e arbustos) em ruas, margens, praças e quintais.
- **Letreiro #EUPASSODETORRES** ao lado do pé da escada de SC.
- **Projetor LED 10 W foco fechado**: corpo aletado, lente em domo e suporte em U; perfil angular real (núcleo + halo + espalhamento) no cálculo e no shader; **facho visível no ar** com espalhamento físico (controle "Facho visível no ar" na aba Cena).
- **Editor de luminárias**: crie grupos avulsos, clique para fixar na superfície (chão, fachada, ponte, árvore), clique para mirar, selecione clicando na luminária, mova com setas, ajuste giro/inclinação, duplique e exclua. "Editar individualmente" separa qualquer grupo em luminárias avulsas.
- Navegação mais precisa (sensibilidade ajustável) e câmera impedida de descer abaixo do chão.

## Rodar localmente
Qualquer servidor estático serve (o three.js está em `vendor/`, sem build):
```
python -m http.server 8000
```
e abra http://localhost:8000.

## Premissas
Vão, largura e materiais vêm de fontes publicadas; cotas, flecha e seções foram estimadas a partir de fotografias e pré-dimensionamento. A lista do que é publicado, estimado e precisa de levantamento está em `guia.html#levantamento`. Não substitui projeto estrutural ou luminotécnico executivo.

Feito com [three.js](https://threejs.org) r165 (MIT).
