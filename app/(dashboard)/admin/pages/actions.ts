'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { archiveContentPage, deleteContentPage, saveContentPage } from '@/lib/content/pages';
import { requireCsrfToken } from '@/lib/security/csrf';
export type ContentState={error?:string;success?:string};
const input=(data:FormData)=>({audienceMode:data.get('audienceMode'),audiences:data.getAll('audience'),contentHtml:data.get('contentHtml'),publishAt:data.get('publishAt'),seoDescription:data.get('seoDescription'),seoTitle:data.get('seoTitle'),slug:data.get('slug'),status:data.get('status'),summary:data.get('summary'),title:data.get('title')});
async function csrf(data:FormData){await requireCsrfToken(data,await rawCanonicalSessionId(),await rawCanonicalUserId());}
const message=(e:unknown)=>e instanceof Error&&['AuthorizationError','CsrfError','ContentPageValidationError'].includes(e.name)?e.message:'The page could not be saved.';
export async function createContentPage(_:ContentState,data:FormData){let id;try{await csrf(data);id=await saveContentPage(null,input(data));}catch(e){return{error:message(e)}} revalidatePath('/admin/pages');redirect(`/admin/pages/${id}`);}
export async function updateContentPage(_:ContentState,data:FormData){try{await csrf(data);await saveContentPage(data.get('id'),input(data));revalidatePath('/admin/pages');revalidatePath(`/pages/${data.get('slug')}`);return{success:'Page saved.'}}catch(e){return{error:message(e)}}}
export async function archivePage(_:ContentState,data:FormData){try{await csrf(data);await archiveContentPage(data.get('id'));revalidatePath('/admin/pages');return{success:'Page archived.'}}catch(e){return{error:message(e)}}}
export async function deletePage(_:ContentState,data:FormData){try{await csrf(data);await deleteContentPage(data.get('id'));}catch(e){return{error:message(e)}} revalidatePath('/admin/pages');redirect('/admin/pages');}
