function buildKnowledgeExcerpt(item,input,maxChars=4500){
  const source=String(item?.content||'')
    .replace(/\\r\\n/g,'\\n')
    .replace(/[\\t ]+/g,' ')
    .replace(/\\n{3,}/g,'\\n\\n')
    .trim()
    .slice(0,150000);
  if(!source) return '';

  const stopWords=new Set([
    'what','who','when','where','which','how','why','does','do','did',
    'the','a','an','is','are','was','were','be','to','of','for','and',
    'or','in','on','with','one','sentence','please','explain'
  ]);
  const terms=[...new Set(
    String(input||'').toLowerCase().split(/\\W+/)
      .filter(x=>x.length>2&&!stopWords.has(x))
  )].slice(0,16);

  if(!terms.length) return source.slice(0,maxChars);

  const paragraphs=source.split(/\\n\\s*\\n/)
    .map(x=>x.trim())
    .filter(Boolean);

  const scored=paragraphs.map((paragraph,index)=>{
    const lower=paragraph.toLowerCase();
    const score=terms.reduce((n,term)=>n+(lower.includes(term)?1:0),0);
    return {paragraph,index,score};
  }).filter(x=>x.score>0);

  if(!scored.length) return source.slice(0,maxChars);

  const selected=[];
  let used=0;
  for(const item of [...scored].sort((a,b)=>b.score-a.score||a.index-b.index)){
    const extra=item.paragraph.length+(selected.length?2:0);
    if(used+extra>maxChars) continue;
    selected.push(item);
    used+=extra;
    if(selected.length>=8) break;
  }

  return selected
    .sort((a,b)=>a.index-b.index)
    .map(x=>x.paragraph)
    .join('\\n\\n')
    .slice(0,maxChars);
}

module.exports={buildKnowledgeExcerpt};
