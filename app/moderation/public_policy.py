"""Non-secret publishing metadata, independent of moderator credentials."""
import os
from fastapi import APIRouter, Response
# Owner-confirmed public defaults. Explicit environment values still override them.
router=APIRouter()

@router.get('/public/policy')
async def public_policy(response: Response):
    response.headers['Cache-Control']='no-store'
    operator=os.getenv('BHIDNE_HO_POLICY_OPERATOR','Lfactorial').strip()
    contact=os.getenv('BHIDNE_HO_SUPPORT_EMAIL','prajwal@lfactorial.com').strip()
    age=os.getenv('BHIDNE_HO_MINIMUM_AGE','18').strip()
    backups=os.getenv('BHIDNE_HO_BACKUP_DISCLOSURE','Database backups are not configured.').strip()
    valid_age=age.isdigit() and 1<=int(age)<=100
    return dict(ready=bool(operator and '@' in contact and valid_age and backups),operator=operator,
                contact=contact,minimum_age=int(age) if valid_age else None,backups=backups)
