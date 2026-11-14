-- Handbook order (James): General Information, Safety, Code of Conduct, Notice of Race, Sailing Instructions.
update handbook_sections set position = case slug
  when 'general-information'  then 1
  when 'safety'               then 2
  when 'code-of-conduct'      then 3
  when 'notice-of-race'       then 4
  when 'sailing-instructions' then 5
  else position end;
