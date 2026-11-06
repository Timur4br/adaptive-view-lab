"""Build offline-readable HTML documentation using only Python's standard library.
Supports the limited Markdown subset used by this repository, not arbitrary HTML.
"""
from pathlib import Path
import json,html,re
ROOT=Path(__file__).resolve().parents[1]
DOCS=ROOT/'docs'
NAMES={'object_only':'Вокруг объекта','periodic_3':'Эталон каждый третий','alternating':'Чередование 1 к 1','random':'Случайный выбор','frozen_plan':'План по первым кадрам','adaptive':'Адаптивный выбор','wide_only':'Только общие планы'}
SCENARIOS={'reference_weak':'Слабая геометрия эталона','object_weak':'Слабая геометрия объекта','balanced':'Устойчивая начальная геометрия','reference_floor':'Неточная длина эталона','noise_underestimated':'Шум выше прогноза вдвое'}
def number(x,n=3):return f'{x:.{n}f}'.replace('.',',')
def write_results():
    summary=json.loads((ROOT/'data/published/summary.json').read_text(encoding='utf-8'))
    pairs=json.loads((ROOT/'data/published/paired_comparisons.json').read_text(encoding='utf-8'))
    lines=['# Результаты компьютерного моделирования','','## Объём и происхождение данных','',
        'Сохранённое исследование от 6 ноября 2026 года. В пяти сценариях выполнено по 800 независимых повторений. Семь стратегий используют общие наблюдения внутри повторения: всего 4000 независимых сессий и 28000 траекторий стратегий.',
        '', 'Основная сцена содержит два пространственных отрезка и известные без ошибки позы камер. Это проверка геометрического измерения на смоделированных координатах изображений. Реальные фотографии, распознавание точек и оценивание поз камер не использовались.',
        '', '## Слабая геометрия масштабного образца','',
        '| Стратегия | RMSE мм | Медиана u мм | Покрытие % |','| --- | ---: | ---: | ---: |']
    for x in summary:
        if x['scenario']=='reference_weak':lines.append(f"| {NAMES[x['strategy']]} | {number(x['rmse_mm'])} | {number(x['median_u_mm'])} | {number(100*x['coverage95'],2)} |")
    lines+=['','RMSE показывает фактическую среднеквадратическую ошибку по независимым сессиям. u — расчётная стандартная неопределённость. Покрытие — доля сессий, где истинная длина попала в приближённый интервал q ± 1,96u. Это разные показатели.','',
      '## Парные сравнения','',
      '| Сравнение адаптации с | Отношение RMSE | 95% интервал |','| --- | ---: | --- |']
    for x in pairs:
        if x['scenario']=='reference_weak':lines.append(f"| {NAMES[x['comparator']]} | {number(x['rmse_ratio'])} | {number(x['ratio_ci95'][0])} … {number(x['ratio_ci95'][1])} |")
    lines+=['','Интервалы получены 3000 парными бутстреп-перевыборками целых сессий. Это отдельные исследовательские интервалы без поправки на множественные сравнения. Интервал сравнения с первоначальным планом включает единицу. Преимущество адаптации перед сильным планом и чередованием не установлено.','',
      '## Пять сценариев','',
      '| Сценарий | RMSE адаптации мм | Покрытие % |','| --- | ---: | ---: |']
    for x in summary:
        if x['strategy']=='adaptive':lines.append(f"| {SCENARIOS[x['scenario']]} | {number(x['rmse_mm'])} | {number(x['coverage95']*100,2)} |")
    lines+=['','При неопределённости внешней длины образца 1 мм только её вклад в стандартную неопределённость результата составляет около 1,321 мм. Повторная съёмка того же образца не уменьшает ошибку его внешней физической длины.','',
      'При шуме вдвое выше прогноза номинальное 95-процентное покрытие снижается до 67%. Уменьшение расчётной дисперсии само по себе не подтверждает достоверность интервала.','',
      '## Что можно утверждать','',
      'В исследованной модели совместное наблюдение объекта и масштаба полезно. При этом статическая сцена с известными параметрами не показала самостоятельного преимущества обновления плана относительно хорошего первоначального решения. Следующие проверки должны учитывать неопределённые позы, изменяющуюся видимость, неодинаковое качество кадров и реальные затраты.',
      '', '## Файлы для проверки','',
      '[Полная сводная таблица](../data/published/summary.csv), [настройки](../data/published/settings.json), [парные сравнения](../data/published/paired_comparisons.json) и [исходный вычислительный код](../research/run_experiments.py) доступны в репозитории.',
      '', 'Полные банки NPZ и траектории генерируются повторным запуском. Компактная веб-сводка и пять контрольных сессий включены в проект. Браузерная модель сверена с Python на 315 состояниях с допуском 0,000001 для длины и неопределённости.',
      '', '[Ограничения модели и источники](method.md).']
    (DOCS/'results.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')

def inline(text):
    text=html.escape(text)
    text=re.sub(r'`([^`]+)`',r'<code>\1</code>',text)
    text=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',text)
    def link(m):
        href=m.group(2)
        if href.endswith('.md'):href=href[:-3]+'.html'
        if href.lower().startswith(('javascript:','data:')):return m.group(1)
        return '<a href="'+href+'">'+m.group(1)+'</a>'
    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)',link,text)

def convert(text):
    lines=text.splitlines();out=[];i=0;toc=[]
    while i<len(lines):
        line=lines[i]
        if not line.strip():i+=1;continue
        if line.startswith('# '):i+=1;continue
        if line.startswith('## '):
            title=line[3:];anchor='section-'+str(len(toc)+1);toc.append((anchor,title));out.append(f'<h2 id="{anchor}">{inline(title)}</h2>');i+=1;continue
        if line.startswith('### '):out.append('<h3>'+inline(line[4:])+'</h3>');i+=1;continue
        if line.startswith('```'):
            code=[];i+=1
            while i<len(lines) and not lines[i].startswith('```'):code.append(lines[i]);i+=1
            out.append('<pre><code>'+html.escape('\n'.join(code))+'</code></pre>');i+=1;continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].startswith('|'):
                row=[x.strip() for x in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?',x) for x in row):rows.append(row)
                i+=1
            body=[]
            for k,row in enumerate(rows):
                tag='th' if k==0 else 'td';body.append('<tr>'+''.join(f'<{tag}>{inline(x)}</{tag}>' for x in row)+'</tr>')
            out.append('<div class="reader-table"><table>'+''.join(body)+'</table></div>');continue
        if re.match(r'^(?:\d+\. |\- )',line):
            ordered=bool(re.match(r'^\d+\. ',line));tag='ol' if ordered else 'ul';items=[]
            while i<len(lines) and re.match(r'^\d+\. ' if ordered else r'^\- ',lines[i]):
                content=re.sub(r'^\d+\. ' if ordered else r'^\- ','',lines[i]);items.append('<li>'+inline(content)+'</li>');i+=1
            out.append(f'<{tag}>'+''.join(items)+f'</{tag}>');continue
        para=[line];i+=1
        while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','|','```','- ')) and not re.match(r'^\d+\. ',lines[i]):para.append(lines[i]);i+=1
        out.append('<p>'+inline(' '.join(para))+'</p>')
    return ''.join(out),toc

def main():
    write_results()
    pages=['method','results','real-experiments','github-pages']
    for name in pages:
        src=DOCS/(name+'.md')
        if not src.exists():continue
        text=src.read_text(encoding='utf-8');title=text.splitlines()[0].lstrip('# ');body,toc=convert(text)
        nav=''.join(f'<a href="{n}.html"'+(' aria-current="page"' if n==name else '')+'>'+label+'</a>' for n,label in [('method','Метод'),('results','Результаты'),('real-experiments','Реальная съёмка'),('github-pages','GitHub Pages')])
        content=f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)} — Ракурс</title><link rel="icon" href="../assets/favicon.svg"><link rel="stylesheet" href="../assets/styles.css"></head><body class="guide-page"><header class="guide-header wrap"><a class="wordmark" href="../index.html">РАКУРС</a><a href="../index.html">К интерактивной модели ↗</a></header><main class="reader-layout wrap"><aside class="reader-nav"><span class="eyebrow">ДОКУМЕНТАЦИЯ</span>{nav}<div class="reader-toc">{''.join('<a href="#'+a+'">'+html.escape(t)+'</a>' for a,t in toc)}</div></aside><article class="reader"><p class="eyebrow">ADAPTIVE VIEW LAB / v0.1.0</p><h1>{html.escape(title)}</h1>{body}</article></main><footer class="footer wrap"><span>Т. А. Галаветдинов · УГГУ</span><a href="../index.html">Вернуться к модели</a></footer></body></html>'''
        (DOCS/(name+'.html')).write_text(content,encoding='utf-8')
    print('Built documentation pages')
if __name__=='__main__':main()
