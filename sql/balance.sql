--- Find used accounts 
SELECT DISTINCT a.id, a.number FROM verification_row AS vr LEFT JOIN account AS a ON vr.account_id=a.id WHERE a.number LIKE '2%%%'; 

--- Account sums
SELECT a.number, SUM(vr.debet)-SUM(vr.credit) AS "sum" FROM verification_row AS vr 
  LEFT JOIN verification AS v ON v.id=vr.verification_id
  LEFT JOIN account AS a ON vr.account_id=a.id 
  WHERE a.number LIKE '1%%%' AND v.date<'2015-09-01'
  GROUP BY a.number; 

--- A view for simplifying verifications 
CREATE VIEW ver_view AS SELECT vr.debet, vr.credit, a.number, v.date 
  FROM verification_row AS vr 
  LEFT JOIN verification AS v ON v.id=vr.verification_id
  LEFT JOIN account AS a ON vr.account_id=a.id;

--- Balance of one account, at a date    
SELECT SUM(debet) - SUM(credit) FROM ver_view WHERE NUMBER='1930' AND DATE<'2015-09-01';
