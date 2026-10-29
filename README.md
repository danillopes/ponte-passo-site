# Ponte Pênsil do Rio Mampituba — modelo 3D + estudo luminotécnico

Modelo 3D paramétrico da ponte pênsil que liga **Torres (RS)** a **Passo de Torres (SC)**, reconstruída em 2024, com um simulador de iluminação LED em unidades físicas.

**Abrir:** `index.html` (modelo interativo) · `guia.html` (memorial técnico) · `blender/ponte_pensil_blender.py` (gerador para Blender 3.6/4.x)

## O que tem
- Ponte completa: torres-pórtico, 4 cabos em parábola (flecha 7,05 m), 98 pendurais a cada 2 m, transversinas, longarinas, 617 pranchas, guarda-corpo de 1,20 m com tela, patamares, escadas e ancoragens.
- Cenário: rio com reflexo e ondulação, cais, praças, cidade de Torres (edifícios) e Passo de Torres (casas), barcos, pessoas em escala, iluminação pública existente e a ponte de concreto ao fundo (posição aproximada).
- 10 grupos de luminárias (cabos, corrimão, pendurais, torres, pórtico, sob o tabuleiro, cais, rodapé, escadas e avulsas posicionadas por clique) com 8 modelos de LED.
- Para cada grupo: cor (CCT 1800–6500 K ou RGB), potência, dimerização, eficácia, facho e **luminância em nits** (a potência é recalculada a partir dos nits).
- Luzes em candela e emissores em cd/m²; cálculo ponto a ponto de lux no piso (Em, Emin, Emax, U0), mapa de falsa cor e checagem com a NBR 5101 (P1–P4).
- Efeitos DMX (respiração, onda, corrida, arco-íris), períodos (noite, hora azul, dia), cotas sobre o modelo.
- Exporta GLB (Blender/Rhino/3ds Max, com luzes spot), CSV de quantitativo, projeto em JSON e imagem PNG.

## Rodar localmente
Qualquer servidor estático serve (o three.js está em `vendor/`, sem build):
```
python -m http.server 8000
```
e abra http://localhost:8000.

## Premissas
Vão, largura e materiais vêm de fontes publicadas; cotas, flecha e seções foram estimadas a partir de fotografias e pré-dimensionamento. Detalhes e fontes no `guia.html`. Não substitui projeto estrutural ou luminotécnico executivo.

Feito com [three.js](https://threejs.org) r165 (MIT).
