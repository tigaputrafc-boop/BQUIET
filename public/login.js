const form=document.querySelector('#login-form');
const password=document.querySelector('#password');
const err=document.querySelector('#error');
const submit=form.querySelector('.submit');
document.querySelector('#toggle').addEventListener('click',()=>{
  password.type=password.type==='password'?'text':'password';
});
form.addEventListener('submit',async event=>{
  event.preventDefault();err.textContent='';submit.disabled=true;
  try{
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:password.value})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Login gagal.');
    location.replace('/');
  }catch(error){err.textContent=error.message;submit.disabled=false;}
});
