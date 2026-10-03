const test=require('node:test');
const assert=require('node:assert/strict');
const {buildKnowledgeExcerpt}=require('../knowledge/context');

test('knowledge context sends only relevant excerpts',()=>{
  const secret='KRATIVE INTELLIGENCE CONNECTS HUMAN KNOWLEDGE WITH GOVERNED DIGITAL INTELLIGENCE.';
  const master=[
    '# KRATIVE T3CH MASTER KNOWLEDGE',
    '',
    '## Company identity',
    'Krative T3ch builds technology that connects intelligence to the world.',
    '',
    '## Krative Core',
    'Krative Core is the foundational/deep intelligence engine and software architecture of Krative T3ch.',
    'It is the brain/foundation beneath connected assistants and products.',
    '',
    '## Security',
    'KIA must not reveal protected implementation secrets.',
    '',
    '## KIA DOCUMENT INTELLIGENCE TEST',
    'The secret test phrase in this document is:',
    secret
  ].join('\n');
  const excerpt=buildKnowledgeExcerpt({content:master},'explain in one sentence what Krative Core does');
  assert.match(excerpt,/Krative Core is the foundational/i);
  assert.ok(!excerpt.includes(secret));
  assert.ok(excerpt.length<master.length);
});

test('knowledge context falls back safely when no terms match',()=>{
  const content='A short internal knowledge note with no matching query terms.';
  const excerpt=buildKnowledgeExcerpt({content},'zzzzzz');
  assert.equal(excerpt,content);
});
