                                            

/** Plaintext carried inside the encrypted envelope. The broker never sees it. */
                          
               
               
                                
                 
 

/** What the sender signs: the payload fields exactly as sent, bound to the envelope's routing metadata. */
                                                                   

                              
              
             
                          
                    
                     
 

                               
                          
                     
 

export function parsePayload(json        )                {
  const data = JSON.parse(json)                          ;
  if (
    typeof data.type !== "string" ||
    typeof data.body !== "string" ||
    typeof data.sentAt !== "string" ||
    typeof data.pub !== "string" ||
    typeof data.sig !== "string"
  ) {
    throw new Error("Invalid or unsigned payload");
  }
  return { type: data.type, body: data.body, meta: data.meta, sentAt: data.sentAt, pub: data.pub, sig: data.sig };
}

/** Canonical text covered by the signature. Field order is fixed so sender and receiver agree. */
export function signingInput(aad        , p         )         {
  return `${aad}
${JSON.stringify({ type: p.type, body: p.body, meta: p.meta, sentAt: p.sentAt })}`;
}
