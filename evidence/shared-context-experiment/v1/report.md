# Shared context vs baseline

Rondas: baseline 3, shared 3. Casos: baseline 33, shared 33. Generado: 2026-11-18T07:01:05.056Z.

## Veredicto (solo cifras)

- Coste por caso (sin juez, precios relativos de Anthropic con caché): +39.4 % (28,404 -> 39,604 unidades)
- Input tokens por caso (sin juez): +66.9 % (37,223 -> 62,115)
- Input tokens por caso (con juez): +62.9 %
- Output tokens por caso (sin juez): +23.7 %
- Llamadas LLM por caso (sin juez): 4.94 -> 8.21 (+66.3 %)
- Latencia media: +70.8 % (46.7 s -> 79.8 s); mediana: +63.7 %
- Pass rate: 30/33 (shared) vs 33/33 (baseline)

## Calidad y latencia

| Variante | Pass rate | Duración media | Duración mediana |
| --- | --- | --- | --- |
| baseline | 33/33 | 46.7 s | 28.2 s |
| shared | 30/33 | 79.8 s | 46.1 s |

### Pases por caso

| Caso | baseline | shared | Checks fallidos (baseline) | Checks fallidos (shared) |
| --- | --- | --- | --- | --- |
| v2-clarify-most-dominant-team | 3/3 | 3/3 | - | - |
| v2-compare-goals-per-match-2018-2022 | 3/3 | 3/3 | - | - |
| v2-coverage-group-stage-wins | 3/3 | 2/3 | - | llm-judge |
| v2-multistep-top-team-top-scorer-2022 | 3/3 | 3/3 | - | - |
| v2-no-clarify-total-goals | 3/3 | 3/3 | - | - |
| v2-out-of-coverage-2014-final | 3/3 | 3/3 | - | - |
| v2-ranking-ties-busiest-stadium | 3/3 | 1/3 | - | llm-judge, names-all, states-numbers, llm-judge |
| v2-ranking-ties-top-scorers-2018 | 3/3 | 3/3 | - | - |
| v2-retry-reuses-attempt-1 | 3/3 | 3/3 | - | - |
| v2-share-penalty-goals-2022 | 3/3 | 3/3 | - | - |
| v2-value-lookup-free-kick-goals | 3/3 | 3/3 | - | - |

## Tokens

Media por caso = total / casos de todas las rondas. "Input" = input + cache read + cache creation.

| Etiqueta | Variante | Llamadas | Input total | Output total | Input/caso | Output/caso | requestChars/caso | Δ input/caso |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plan | baseline | 33 | 80,400 | 11,699 | 2,436 | 355 | 7,076 |  |
|  | shared | 68 | 249,986 | 22,119 | 7,575 | 670 | 20,132 | +210.9 % |
| analyse | baseline | 99 | 1,062,513 | 49,164 | 32,197 | 1,490 | 84,551 |  |
|  | shared | 127 | 1,477,836 | 53,222 | 44,783 | 1,613 | 116,015 | +39.1 % |
| write-answer | baseline | 30 | 83,838 | 22,220 | 2,541 | 673 | 6,884 |  |
|  | shared | 69 | 310,747 | 25,981 | 9,417 | 787 | 23,485 | +270.7 % |
| sql-repair | baseline | 1 | 1,604 | 231 | 49 | 7 | 123 |  |
|  | shared | 7 | 11,229 | 1,745 | 340 | 53 | 862 | +600.1 % |
| judge | baseline | 33 | 149,381 | 12,203 | 4,527 | 370 | 11,112 |  |
|  | shared | 33 | 194,716 | 13,963 | 5,900 | 423 | 14,295 | +30.3 % |
| other | baseline | 0 | 0 | 0 | 0 | 0 | 0 |  |
|  | shared | 0 | 0 | 0 | 0 | 0 | 0 | n/a |
| total | baseline | 196 | 1,377,736 | 95,517 | 41,750 | 2,894 | 109,746 |  |
|  | shared | 304 | 2,244,514 | 117,030 | 68,016 | 3,546 | 174,790 | +62.9 % |
| total workflow (sin juez) | baseline | 163 | 1,228,355 | 83,314 | 37,223 | 2,525 | 98,634 |  |
|  | shared | 271 | 2,049,798 | 103,067 | 62,115 | 3,123 | 160,495 | +66.9 % |

| Métrica (workflow, sin juez) | baseline | shared | Cambio |
| --- | --- | --- | --- |
| Input/caso | 37,223 | 62,115 | +66.9 % |
| Output/caso | 2,525 | 3,123 | +23.7 % |
| requestChars/caso | 98,634 | 160,495 | +62.7 % |

## Llamadas LLM y tool_use por caso

| Etiqueta | Llamadas/caso baseline | Llamadas/caso shared | tool_use/caso baseline | tool_use/caso shared |
| --- | --- | --- | --- | --- |
| plan | 1.00 | 2.06 | 0.00 | 3.61 |
| analyse | 3.00 | 3.85 | 3.12 | 5.91 |
| write-answer | 0.91 | 2.09 | 0.00 | 3.00 |
| sql-repair | 0.03 | 0.21 | 0.00 | 0.00 |
| judge | 1.00 | 1.00 | 0.00 | 0.00 |
| other | 0.00 | 0.00 | 0.00 | 0.00 |
| total workflow (sin juez) | 4.94 | 8.21 | 3.12 | 12.52 |

## Lecturas del board (shared)

| Lecturas | Lecturas/caso | Chars leídos | Chars/caso |
| --- | --- | --- | --- |
| 307 | 9.30 | 140,144 | 4,247 |
